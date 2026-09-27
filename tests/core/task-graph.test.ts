import { describe, expect, it } from 'vitest';
import { TaskGraph } from '../../src/core/task-graph';
import type { MissionTask } from '../../src/core/types';

const tasks: MissionTask[] = [
  {
    id: 'a',
    title: 'A',
    description: 'A',
    requires: [],
    dependsOn: [],
    risk: 'low',
    maxAttempts: 1,
  },
  {
    id: 'b',
    title: 'B',
    description: 'B',
    requires: [],
    dependsOn: ['a'],
    risk: 'low',
    maxAttempts: 1,
  },
];

describe('TaskGraph', () => {
  it('orders dependencies before dependents', () => {
    const graph = new TaskGraph(tasks);
    expect(graph.topologicalOrder().map((task) => task.id)).toEqual(['a', 'b']);
  });

  it('rejects cycles', () => {
    expect(
      () =>
        new TaskGraph([
          { ...tasks[0], dependsOn: ['b'] },
          { ...tasks[1], dependsOn: ['a'] },
        ]),
    ).toThrow(/cycle/);
  });
});
