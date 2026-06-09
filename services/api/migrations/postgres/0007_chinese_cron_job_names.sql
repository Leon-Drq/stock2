update cron_jobs
set name = case id
  when 'radar-cron' then '雷达信号刷新'
  when 'radar-track' then '雷达价格跟踪'
  when 'paper-trading-cron' then '模拟交易刷新'
  when 'backtest-data-cron' then '回测数据预热'
  when 'strategy-miner-cron' then '策略挖掘任务'
  when 'backtest-jobs-cron' then '回测队列调度'
  else name
end,
updated_at = now()
where id in (
  'radar-cron',
  'radar-track',
  'paper-trading-cron',
  'backtest-data-cron',
  'strategy-miner-cron',
  'backtest-jobs-cron'
);
