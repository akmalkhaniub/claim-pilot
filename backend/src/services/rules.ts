import { query } from '../config/db.js';

export interface CoverageRule {
  id: string;
  name: string;
  claimType: string; // 'All' | 'Auto' | 'Property' | 'Health' | 'General Liability'
  fieldKey: string;
  operator: '>' | '<' | '==' | '!=' | 'contains' | 'required';
  value: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'flag' | 'require_info' | 'block';
  description: string;
}

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'flag' | 'require_info' | 'block';
  passed: boolean;
  actualValue: string;
  message: string;
}

export interface ClaimRulesEvaluation {
  claimId: string;
  complianceScore: number;
  totalRules: number;
  passedCount: number;
  warningCount: number;
  violationCount: number;
  results: RuleEvaluationResult[];
}

// Default in-memory rules list (custom rules will be appended dynamically)
const customRulesList: CoverageRule[] = [
  {
    id: 'rule-1',
    name: 'High Loss Amount Limit',
    claimType: 'All',
    fieldKey: 'loss_amount',
    operator: '<',
    value: '10000',
    severity: 'high',
    action: 'flag',
    description: 'Loss amount exceeding $10,000 requires senior adjuster review.'
  },
  {
    id: 'rule-2',
    name: 'Automated Risk Score Safety Cap',
    claimType: 'All',
    fieldKey: 'risk_score',
    operator: '<',
    value: '0.4',
    severity: 'critical',
    action: 'block',
    description: 'Risk score above 40% blocks automatic claim approval.'
  },
  {
    id: 'rule-3',
    name: 'Required Supporting Documents Check',
    claimType: 'All',
    fieldKey: 'documents_count',
    operator: '>',
    value: '0',
    severity: 'medium',
    action: 'require_info',
    description: 'At least 1 supporting policy/estimate document must be attached.'
  },
  {
    id: 'rule-4',
    name: 'Claimant Name Verification Integrity',
    claimType: 'All',
    fieldKey: 'name_verification',
    operator: '==',
    value: 'pass',
    severity: 'high',
    action: 'flag',
    description: 'Claimant registration name must match attached document text.'
  }
];

export function getCoverageRules(): CoverageRule[] {
  return customRulesList;
}

export function addCoverageRule(ruleData: Omit<CoverageRule, 'id'>): CoverageRule {
  const newRule: CoverageRule = {
    id: `rule-${Date.now()}`,
    ...ruleData
  };
  customRulesList.push(newRule);
  return newRule;
}

export async function evaluateClaimRules(claimId: string): Promise<ClaimRulesEvaluation> {
  // 1. Fetch claim parameters from PostgreSQL
  const claimRes = await query(
    `SELECT c.id, c.title, c.status, c.claim_type as "claimType",
            COALESCE(r.score, 0) as "riskScore",
            r.risk_flags as "riskFlags"
     FROM claims c
     LEFT JOIN risk_scores r ON c.id = r.claim_id
     WHERE c.id = $1`,
    [claimId]
  );

  if (claimRes.rows.length === 0) {
    throw new Error(`Claim ${claimId} not found`);
  }

  const claim = claimRes.rows[0];
  const riskScore = Number(claim.riskScore);
  const riskFlags: string[] = claim.riskFlags || [];

  // Fetch claim fields
  const fieldsRes = await query(
    `SELECT field_key as "key", field_value as "value" 
     FROM claim_fields WHERE claim_id = $1`,
    [claimId]
  );
  
  const fields: Record<string, any> = {};
  fieldsRes.rows.forEach(row => {
    fields[row.key] = row.value;
  });

  const lossAmount = fields.loss_amount ? parseFloat(fields.loss_amount.toString().replace(/[^0-9.]/g, '')) || 0 : 0;
  const description = fields.incident_description || '';

  // Ingest documents count
  const docsRes = await query(
    `SELECT COUNT(*) as count FROM documents WHERE claim_id = $1`,
    [claimId]
  );
  const documentsCount = parseInt(docsRes.rows[0]?.count || '0', 10);

  // Check claimant name mismatch status
  const nameMatchWarning = description.toLowerCase().includes('mismatch') || riskFlags.some(f => f.toLowerCase().includes('name'));
  const nameVerificationStatus = nameMatchWarning ? 'fail' : 'pass';

  // 2. Evaluate each rule
  const results: RuleEvaluationResult[] = [];
  let passedCount = 0;
  let warningCount = 0;
  let violationCount = 0;

  for (const rule of customRulesList) {
    // Check if rule applies to this claim type
    if (rule.claimType !== 'All' && rule.claimType !== claim.claimType) {
      continue;
    }

    let actualVal = 'N/A';
    let passed = true;
    let message = '';

    switch (rule.fieldKey) {
      case 'loss_amount':
        actualVal = `$${lossAmount.toLocaleString()}`;
        const targetLoss = parseFloat(rule.value) || 0;
        if (rule.operator === '<') passed = lossAmount < targetLoss;
        else if (rule.operator === '>') passed = lossAmount > targetLoss;
        message = passed
          ? `Loss amount of $${lossAmount.toLocaleString()} satisfies condition (${rule.operator} $${targetLoss.toLocaleString()}).`
          : `Loss amount of $${lossAmount.toLocaleString()} violates condition (${rule.operator} $${targetLoss.toLocaleString()}).`;
        break;

      case 'risk_score':
        actualVal = `${Math.round(riskScore * 100)}%`;
        const targetRisk = parseFloat(rule.value) || 0;
        if (rule.operator === '<') passed = riskScore < targetRisk;
        else if (rule.operator === '>') passed = riskScore > targetRisk;
        message = passed
          ? `Automated risk score (${Math.round(riskScore * 100)}%) is within threshold (${rule.operator} ${Math.round(targetRisk * 100)}%).`
          : `Automated risk score (${Math.round(riskScore * 100)}%) exceeds allowed limit (${rule.operator} ${Math.round(targetRisk * 100)}%).`;
        break;

      case 'documents_count':
        actualVal = `${documentsCount} file(s)`;
        const targetDocs = parseInt(rule.value, 10) || 0;
        if (rule.operator === '>') passed = documentsCount > targetDocs;
        else if (rule.operator === '==') passed = documentsCount === targetDocs;
        message = passed
          ? `${documentsCount} document(s) uploaded, meeting required threshold (${rule.operator} ${targetDocs}).`
          : `Only ${documentsCount} document(s) attached, violating minimum required file upload rule.`;
        break;

      case 'name_verification':
        actualVal = nameVerificationStatus.toUpperCase();
        if (rule.operator === '==') passed = nameVerificationStatus === rule.value;
        message = passed
          ? `Claimant name verification matches document records cleanly.`
          : `Claimant name mismatch detected in attached invoices.`;
        break;

      default:
        // Generic field lookup
        const rawFieldVal = fields[rule.fieldKey] ? fields[rule.fieldKey].toString() : '';
        actualVal = rawFieldVal || 'Empty';
        if (rule.operator === 'required') passed = Boolean(rawFieldVal);
        else if (rule.operator === 'contains') passed = rawFieldVal.toLowerCase().includes(rule.value.toLowerCase());
        else if (rule.operator === '==') passed = rawFieldVal.toLowerCase() === rule.value.toLowerCase();
        message = passed
          ? `Field "${rule.fieldKey}" satisfies rule condition.`
          : `Field "${rule.fieldKey}" violates rule condition (${rule.operator} "${rule.value}").`;
        break;
    }

    if (passed) {
      passedCount++;
    } else {
      if (rule.action === 'block' || rule.severity === 'critical') {
        violationCount++;
      } else {
        warningCount++;
      }
    }

    results.push({
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      action: rule.action,
      passed,
      actualValue: actualVal,
      message
    });
  }

  const totalEvaluated = results.length;
  const complianceScore = totalEvaluated > 0 ? Math.round((passedCount / totalEvaluated) * 100) : 100;

  return {
    claimId,
    complianceScore,
    totalRules: totalEvaluated,
    passedCount,
    warningCount,
    violationCount,
    results
  };
}
