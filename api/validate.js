export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, type } = req.body;
  if (!text || text.trim().length < 10)
    return res.status(400).json({ error: 'Please provide at least 10 characters.' });

  const result = validate(text.trim(), type);
  return res.status(200).json(result);
}

function validate(text, typeHint) {
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).length;

  // Detect type
  const detectedType = typeHint && typeHint !== 'auto'
    ? typeHint
    : (lower.includes('epic') || words > 80 || lower.includes('initiative') || lower.includes('programme'))
      ? 'epic'
      : 'user_story';

  // ── Structure detection ──────────────────────────────────────────────────
  const asAMatch   = text.match(/as\s+an?\s+([^,\.]+)/i);
  const iWantMatch = text.match(/i\s+want\s+(?:to\s+)?([^,\.so]+)/i);
  const soThatMatch= text.match(/so\s+that\s+(.+)/i);
  const acLines    = text.split('\n').filter(l => /^AC\s*:|acceptance criteria/i.test(l));

  const hasPersona   = !!asAMatch;
  const hasGoal      = !!iWantMatch;
  const hasBenefit   = !!soThatMatch;
  const hasAC        = acLines.length > 0 || /\bAC\d|\bacceptance criteria\b/i.test(text);

  const persona   = asAMatch   ? asAMatch[1].trim()   : null;
  const goal      = iWantMatch ? iWantMatch[1].trim()  : null;
  const benefit   = soThatMatch? soThatMatch[1].trim() : null;

  // ── INVEST dimension scoring ─────────────────────────────────────────────
  const dims = [];

  // 1. Independent
  const dependsOn = /\b(depends on|after|before|requires story|blocked by|part of story)\b/i.test(text);
  const indScore = dependsOn ? 40 : hasGoal && hasPersona ? 80 : 60;
  dims.push({
    name: 'Independent',
    score: indScore,
    comment: dependsOn
      ? 'Story references a dependency on another story, reducing independence.'
      : indScore >= 75
        ? 'Story appears independently deliverable.'
        : 'Unclear whether this can be delivered independently.'
  });

  // 2. Negotiable
  const solutionWords = /\b(must use|shall use|must be implemented|using react|using java|database|api call|sql|html)\b/i.test(text);
  const negScore = solutionWords ? 45 : hasGoal ? 85 : 65;
  dims.push({
    name: 'Negotiable',
    score: negScore,
    comment: solutionWords
      ? 'Story prescribes a specific technical solution, leaving little room to negotiate implementation.'
      : 'Story focuses on the goal rather than dictating implementation.'
  });

  // 3. Valuable
  const valScore = hasBenefit ? (benefit && benefit.length > 15 ? 90 : 70) : hasGoal ? 50 : 30;
  dims.push({
    name: 'Valuable',
    score: valScore,
    comment: hasBenefit
      ? 'Clear business value expressed in the "so that" clause.'
      : 'Missing explicit benefit statement — add "so that [value]" to make value visible.'
  });

  // 4. Estimable
  const vague = /\b(everything|all|any|stuff|things|various|etc|multiple|several)\b/i.test(text);
  const tooLong = words > 120;
  const estScore = tooLong ? 35 : vague ? 50 : hasGoal && hasPersona ? 80 : 55;
  dims.push({
    name: 'Estimable',
    score: estScore,
    comment: tooLong
      ? 'Story is too long and likely covers multiple concerns — hard to estimate reliably.'
      : vague
        ? 'Vague language (e.g. "various", "etc") makes accurate estimation difficult.'
        : 'Story is specific enough to estimate.'
  });

  // 5. Small / Right-sized
  const conjunctions = (text.match(/\band\b|\balso\b|\bas well as\b/gi) || []).length;
  const smallScore = detectedType === 'epic'
    ? 75
    : words > 100 ? 35 : words < 5 ? 30 : conjunctions >= 3 ? 45 : words <= 60 ? 85 : 65;
  dims.push({
    name: 'Small / Right-sized',
    score: smallScore,
    comment: detectedType === 'epic'
      ? 'Epic scope is expected to be larger — appropriate size for an epic.'
      : words > 100
        ? 'Story is very long. Consider splitting into smaller stories.'
        : conjunctions >= 3
          ? `Found ${conjunctions} "and/also" connectors — this may be doing too much at once.`
          : 'Story appears appropriately sized for a single sprint.'
  });

  // 6. Testable / Acceptance Criteria
  const testScore = hasAC ? 90 : hasBenefit && hasGoal ? 55 : hasGoal ? 45 : 25;
  dims.push({
    name: 'Testable / Acceptance Criteria',
    score: testScore,
    comment: hasAC
      ? 'Acceptance criteria present — story is testable.'
      : 'No acceptance criteria found. Add "AC: ..." lines to make this verifiable.'
  });

  // 7. Clarity & Precision
  const clarityScore = hasPersona && hasGoal && hasBenefit
    ? (hasAC ? 92 : 75)
    : hasPersona && hasGoal ? 60
    : hasGoal ? 40 : 25;
  dims.push({
    name: 'Clarity & Precision',
    score: clarityScore,
    comment: clarityScore >= 80
      ? 'Well-structured with clear persona, goal, and benefit.'
      : clarityScore >= 60
        ? 'Mostly clear but missing some structure elements.'
        : 'Lacks standard story structure — use "As a… I want… so that…" format.'
  });

  // ── Overall score ────────────────────────────────────────────────────────
  const overallScore = Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length);

  // ── Strengths ────────────────────────────────────────────────────────────
  const strengths = [];
  if (hasPersona)  strengths.push(`Clear persona identified: "${persona}"`);
  if (hasGoal)     strengths.push(`Explicit goal stated: "${goal?.slice(0, 60)}${goal?.length > 60 ? '…' : ''}"`);
  if (hasBenefit)  strengths.push(`Business value articulated in "so that" clause`);
  if (hasAC)       strengths.push('Acceptance criteria included — story is directly testable');
  if (!solutionWords) strengths.push('Solution-agnostic — team can choose best implementation');
  if (strengths.length === 0) strengths.push('Story has some basic content to build on');

  // ── Improvements ─────────────────────────────────────────────────────────
  const improvements = [];
  if (!hasPersona)  improvements.push('Add a persona: "As a [specific role]…"');
  if (!hasGoal)     improvements.push('Add a clear goal: "I want to [action]…"');
  if (!hasBenefit)  improvements.push('Add a benefit: "…so that [value/outcome]"');
  if (!hasAC)       improvements.push('Add acceptance criteria: "AC: [condition]" lines');
  if (solutionWords) improvements.push('Remove technical implementation details — describe the goal, not the solution');
  if (conjunctions >= 3) improvements.push(`Split into smaller stories — found ${conjunctions} compound statements`);
  if (tooLong)      improvements.push('Trim story to under 60 words; move details to acceptance criteria');
  if (improvements.length === 0) improvements.push('Consider adding more specific acceptance criteria');

  // ── Recommended changes ───────────────────────────────────────────────────
  const recommendedChanges = [];
  let rcId = 1;

  if (!hasPersona) {
    recommendedChanges.push({
      id: `rc${rcId++}`, category: 'Persona', priority: 'high',
      issue: 'No persona defined — unclear who this story serves',
      change: 'Prefix with "As a [specific user role],"',
      impact: 'Improves Clarity (+15 pts) and Valuable dimensions'
    });
  }
  if (!hasBenefit) {
    recommendedChanges.push({
      id: `rc${rcId++}`, category: 'Benefit', priority: 'high',
      issue: 'No "so that" clause — business value is hidden',
      change: 'Append "…so that [measurable outcome or user benefit]"',
      impact: 'Raises Valuable score from ~50 to ~90 (+40 pts)'
    });
  }
  if (!hasAC) {
    recommendedChanges.push({
      id: `rc${rcId++}`, category: 'Acceptance Criteria', priority: 'high',
      issue: 'No acceptance criteria — story cannot be objectively verified',
      change: 'Add 2–4 lines starting with "AC:" describing pass/fail conditions',
      impact: 'Raises Testable score to 90+ and Clarity to 90+'
    });
  }
  if (solutionWords) {
    recommendedChanges.push({
      id: `rc${rcId++}`, category: 'Negotiable', priority: 'medium',
      issue: 'Story specifies technical implementation',
      change: 'Replace technical constraints with outcome requirements',
      impact: 'Raises Negotiable score from ~45 to ~85 (+40 pts)'
    });
  }
  if (conjunctions >= 3) {
    recommendedChanges.push({
      id: `rc${rcId++}`, category: 'Size', priority: 'medium',
      issue: `${conjunctions} compound statements detected — story may be doing too much`,
      change: 'Split into separate stories at each "and/also" boundary',
      impact: 'Raises Small/Estimable scores and improves sprint predictability'
    });
  }
  if (!persona && !goal) {
    recommendedChanges.push({
      id: `rc${rcId++}`, category: 'Structure', priority: 'high',
      issue: 'Story lacks standard Agile format',
      change: 'Rewrite using: "As a [persona], I want [goal], so that [benefit]"',
      impact: 'Foundational — unlocks all INVEST dimensions'
    });
  }
  if (recommendedChanges.length === 0) {
    recommendedChanges.push({
      id: `rc${rcId++}`, category: 'Acceptance Criteria', priority: 'low',
      issue: 'Acceptance criteria could be more specific',
      change: 'Add measurable pass/fail conditions (e.g. "AC: System responds in < 2s")',
      impact: 'Raises Testable and Clarity scores by 5–10 pts'
    });
  }

  // ── Rewrite ───────────────────────────────────────────────────────────────
  const rewritePersona  = persona  || '[specific user role]';
  const rewriteGoal     = goal     || '[clear action or capability]';
  const rewriteBenefit  = benefit  || '[measurable outcome or user benefit]';

  const rewrite = detectedType === 'epic'
    ? `Epic: Enable ${rewriteGoal} for ${rewritePersona}\n\nScope: This epic covers the end-to-end capability to ${rewriteGoal}, delivering ${rewriteBenefit}.\n\nAC: All child stories are complete and integrated\nAC: Feature is accessible to ${rewritePersona} in production\nAC: Success metric is measurable and tracked`
    : `As a ${rewritePersona}, I want to ${rewriteGoal}, so that ${rewriteBenefit}.\n\nAC: Given [context], when [action], then [expected result]\nAC: The feature is accessible and functions correctly on all target devices\nAC: Error states are handled gracefully with clear user feedback`;

  return {
    type: detectedType,
    overallScore,
    dimensions: dims,
    strengths: strengths.slice(0, 4),
    improvements: improvements.slice(0, 4),
    recommendedChanges: recommendedChanges.slice(0, 6),
    rewrite
  };
}
