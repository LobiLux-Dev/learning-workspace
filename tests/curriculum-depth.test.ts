import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPrerequisiteCycle } from '@learning-workspace/schemas';

test('DAG validation handles a large flat catalog with a long prerequisite chain', { timeout: 10_000 }, () => {
  const skills = Array.from({ length: 10_000 }, (_, index) => ({
    id: `skill-${index}`,
    prerequisites: index === 0 ? [] : [`skill-${index - 1}`],
  })).reverse();
  assert.equal(findPrerequisiteCycle(skills), null);
  const root = skills.find((skill) => skill.id === 'skill-0');
  assert.ok(root);
  root.prerequisites.push('skill-9999');
  const cycle = findPrerequisiteCycle(skills);
  assert.ok(cycle !== null && cycle.length > 1);
  assert.equal(cycle[0], cycle.at(-1));
});
