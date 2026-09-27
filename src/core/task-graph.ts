import type { MissionTask } from './types';

export class TaskGraph {
  private readonly tasks = new Map<string, MissionTask>();

  constructor(tasks: MissionTask[]) {
    for (const task of tasks) {
      if (this.tasks.has(task.id)) {
        throw new Error('duplicate task id: ' + task.id);
      }
      this.tasks.set(task.id, task);
    }

    for (const task of tasks) {
      for (const dependency of task.dependsOn) {
        if (!this.tasks.has(dependency)) {
          throw new Error(
            'task ' + task.id + ' depends on missing task ' + dependency,
          );
        }
      }
    }

    this.topologicalOrder();
  }

  get(id: string) {
    return this.tasks.get(id) ?? null;
  }

  list() {
    return [...this.tasks.values()];
  }

  topologicalOrder() {
    const inDegree = new Map<string, number>();
    const children = new Map<string, string[]>();

    for (const task of this.tasks.values()) {
      inDegree.set(task.id, task.dependsOn.length);
      for (const dependency of task.dependsOn) {
        const list = children.get(dependency) ?? [];
        list.push(task.id);
        children.set(dependency, list);
      }
    }

    const queue = [...inDegree.entries()]
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id)
      .sort();

    const ordered: MissionTask[] = [];

    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) break;

      const task = this.tasks.get(id);
      if (!task) continue;
      ordered.push(task);

      for (const child of children.get(id) ?? []) {
        const next = (inDegree.get(child) ?? 0) - 1;
        inDegree.set(child, next);
        if (next === 0) queue.push(child);
      }

      queue.sort();
    }

    if (ordered.length !== this.tasks.size) {
      throw new Error('task graph contains a cycle');
    }

    return ordered;
  }

  readyTasks(completed: Set<string>, failed: Set<string>) {
    return this.list()
      .filter((task) => !completed.has(task.id) && !failed.has(task.id))
      .filter((task) =>
        task.dependsOn.every((dependency) => completed.has(dependency)),
      );
  }
}
