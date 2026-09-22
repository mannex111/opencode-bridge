import { type CronScheduler, type SchedulerJobDefinition } from './scheduler.js';

export interface InternalJobHandlers {
  watchdogProbe: () => Promise<void> | void;
  processConsistencyCheck: () => Promise<void> | void;
  staleCleanup: () => Promise<void> | void;
  budgetReset: () => Promise<void> | void;
}

export interface InternalJobCronExpressions {
  watchdogProbe: string;
  processConsistencyCheck: string;
  staleCleanup: string;
  budgetReset: string;
}

export interface InternalJobRegistryOptions {
  handlers?: Partial<InternalJobHandlers>;
  cronExpressions?: Partial<InternalJobCronExpressions>;
  timezone?: string;
}

const DEFAULT_CRON_EXPRESSIONS: InternalJobCronExpressions = {
  // 2026-09-03 修复：watchdog cron 改为 1 年 1 次
  // 原 '*/30 * * * * *'（每30秒）会持续打不存在的 /health 端点，详见 bootstrap.ts 注释
  // 真正的进程守护由 systemd（Restart=always）负责，watchdog 与 systemd 职责重叠且实际无效
  watchdogProbe: '0 0 1 1 *',
  // Bug 14 v4 修复：原 '0 * * * * *'（每分钟一次）导致 NODE-CRON missed execution
  // 每分钟都警告，原因是 process-consistency-check 任务本身 fetch OpenCode +
  // readPidFile 会阻塞几秒。同时 process-check-job.ts 也注册了同名任务，重复
  // 调用同 checkProcessConsistency() 函数。改成 5 分钟一次匹配 process-check-job
  // 间隔，避免重复调用。
  processConsistencyCheck: '0 */5 * * * *',
  staleCleanup: '0 */5 * * * *',
  budgetReset: '0 0 * * * *',
};

const NOOP_ASYNC_HANDLER = async (): Promise<void> => {
  return;
};

const createDefinitions = (options: InternalJobRegistryOptions = {}): SchedulerJobDefinition[] => {
  const cronExpressions: InternalJobCronExpressions = {
    ...DEFAULT_CRON_EXPRESSIONS,
    ...options.cronExpressions,
  };

  const handlers: InternalJobHandlers = {
    watchdogProbe: options.handlers?.watchdogProbe ?? NOOP_ASYNC_HANDLER,
    processConsistencyCheck: options.handlers?.processConsistencyCheck ?? NOOP_ASYNC_HANDLER,
    staleCleanup: options.handlers?.staleCleanup ?? NOOP_ASYNC_HANDLER,
    budgetReset: options.handlers?.budgetReset ?? NOOP_ASYNC_HANDLER,
  };

  return [
    {
      id: 'watchdog-probe',
      cronExpression: cronExpressions.watchdogProbe,
      timezone: options.timezone,
      waitForCompletion: true,
      run: async () => {
        await handlers.watchdogProbe();
      },
    },
    {
      id: 'stale-cleanup',
      cronExpression: cronExpressions.staleCleanup,
      timezone: options.timezone,
      waitForCompletion: true,
      run: async () => {
        await handlers.staleCleanup();
      },
    },
    {
      id: 'process-consistency-check',
      cronExpression: cronExpressions.processConsistencyCheck,
      timezone: options.timezone,
      waitForCompletion: true,
      run: async () => {
        await handlers.processConsistencyCheck();
      },
    },
    {
      id: 'budget-reset',
      cronExpression: cronExpressions.budgetReset,
      timezone: options.timezone,
      waitForCompletion: true,
      run: async () => {
        await handlers.budgetReset();
      },
    },
  ];
};

export class JobRegistry {
  private readonly definitions: SchedulerJobDefinition[];

  constructor(definitions: SchedulerJobDefinition[]) {
    this.definitions = definitions;
  }

  list(): SchedulerJobDefinition[] {
    return [...this.definitions];
  }

  registerAll(scheduler: CronScheduler): void {
    for (const definition of this.definitions) {
      scheduler.registerJob(definition);
    }
  }
}

export const createInternalJobRegistry = (options: InternalJobRegistryOptions = {}): JobRegistry => {
  return new JobRegistry(createDefinitions(options));
};
