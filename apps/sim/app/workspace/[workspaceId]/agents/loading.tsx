export default function AgentMonitorLoading() {
  return (
    <main className='flex h-full w-full flex-col gap-4 p-5'>
      <h1 className='text-xl'>全局 Agent 会话监控</h1>
      <p role='status' className='text-[var(--text-muted)] text-small'>
        正在读取会话…
      </p>
    </main>
  )
}
