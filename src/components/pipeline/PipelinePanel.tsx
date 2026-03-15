import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { StageCard } from './StageCard'
import { ChatSheet } from '../chat/ChatSheet'
import { usePipeline } from '@/hooks/usePipeline'
import { usePipelineStore } from '@/stores/pipeline'
import { novelApi, projectApi } from '@/lib/api'
import type { PipelineStage, StageStatus } from '@/types/pipeline'
import { STAGE_LABELS, STAGE_ORDER, STAGE_DEPS } from '@/types/pipeline'

interface PipelinePanelProps {
  projectId: number
}

export function PipelinePanel({ projectId }: PipelinePanelProps) {
  const [chatStage, setChatStage] = useState<PipelineStage | null>(null)
  const { pipelines } = usePipelineStore()
  const { activeStage, runStage, cancelStage, confirmStage, resetStage, clearStage, pipeline: localPipeline } = usePipeline(projectId)
  const navigate = useNavigate()

  // 从服务器拉取最新项目状态
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectApi.get(projectId).then((r) => r.data),
    refetchInterval: localPipeline?.current_stage ? 5000 : false, // 运行中时轮询
  })
  const { data: stats } = useQuery({
    queryKey: ['novels-stats', projectId],
    queryFn: () => novelApi.stats(projectId).then((r) => r.data),
  })

  // 合并服务器状态和本地状态（本地优先，用于实时更新）
  const pipeline = localPipeline ?? project?.pipeline_state

  if (!pipeline) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-muted-foreground">加载中...</div>
      </div>
    )
  }

  const isStageDisabled = (stage: PipelineStage): boolean => {
    if ((stats?.total_chapters ?? 0) === 0) return true
    const dep = STAGE_DEPS[stage]
    if (!dep) return false
    const depStatus = (pipeline[dep] ?? 'pending') as StageStatus
    return depStatus !== 'done' && depStatus !== 'skipped'
  }

  const getViewPath = (stage: PipelineStage): string | undefined => {
    const paths: Partial<Record<PipelineStage, string>> = {
      outline: `/projects/${projectId}/outline`,
      script: `/projects/${projectId}/script`,
      storyboard: `/projects/${projectId}/storyboard`,
    }
    return paths[stage]
  }

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-base font-semibold text-foreground">生成流水线</h2>
        {pipeline.error && (
          <span className="text-xs text-red-400">{pipeline.error}</span>
        )}
      </div>

      {/* 阶段卡片列表 */}
      <div className="space-y-2">
        {STAGE_ORDER.map((stage, i) => (
          <StageCard
            key={stage}
            stage={stage}
            label={STAGE_LABELS[stage]}
            status={(pipeline[stage] ?? 'pending') as StageStatus}
            progress={activeStage === stage ? pipeline.current_progress : undefined}
            message={activeStage === stage ? pipeline.current_message : undefined}
            error={pipeline.error}
            isDisabled={isStageDisabled(stage)}
            index={i + 1}
            onRun={() => runStage(stage)}
            onCancel={() => {
              if (window.confirm(`确定要停止「${STAGE_LABELS[stage]}」吗？当前已生成的内容会保留。`)) {
                void cancelStage(stage)
              }
            }}
            onConfirm={() => confirmStage(stage)}
            onReset={() => resetStage(stage)}
            onClear={() => {
              if (window.confirm(`确定要清空「${STAGE_LABELS[stage]}」及后续结果吗？此操作不可撤销。`)) {
                void clearStage(stage)
              }
            }}
            onChat={() => setChatStage(stage)}
            onView={
              getViewPath(stage)
                ? () => navigate({ to: getViewPath(stage)! })
                : undefined
            }
          />
        ))}
      </div>

      {/* Chat 侧边栏 */}
      {chatStage && (
        <ChatSheet
          projectId={projectId}
          stage={chatStage}
          open={!!chatStage}
          onClose={() => setChatStage(null)}
        />
      )}
    </div>
  )
}
