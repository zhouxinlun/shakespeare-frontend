import { Brain, Eye, ImageIcon, Video, Wrench, type LucideIcon } from 'lucide-react'

type BadgeTone = 'success' | 'danger' | 'warning' | 'neutral'

type CapabilityBadgeProps = {
  icon: LucideIcon
  label: string
  tone: BadgeTone
}

type CapabilityBadgesProps = {
  type: string
  supportsTools?: boolean | null
  supportsThinking?: boolean | null
  supportsVision?: boolean | null
  supportsImageGeneration?: boolean | null
  imageMinSize?: string | null
  supportsVideoGeneration?: boolean | null
  videoLabelPrefix?: '生视频' | '视频提交'
  valueStyle?: 'support' | 'result'
}

function toneClass(tone: BadgeTone): string {
  if (tone === 'success') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
  if (tone === 'danger') return 'border-red-500/40 bg-red-500/10 text-red-400'
  if (tone === 'warning') return 'border-amber-500/40 bg-amber-500/10 text-amber-400'
  return 'border-border bg-muted/40 text-muted-foreground'
}

function CapabilityBadge({ icon: Icon, label, tone }: CapabilityBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${toneClass(tone)}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

export function CapabilityBadges({
  type,
  supportsTools,
  supportsThinking,
  supportsVision,
  supportsImageGeneration,
  imageMinSize,
  supportsVideoGeneration,
  videoLabelPrefix = '生视频',
  valueStyle = 'support',
}: CapabilityBadgesProps) {
  const positiveLabel = valueStyle === 'result' ? '通过' : '支持'
  const negativeLabel = valueStyle === 'result' ? '失败' : '不支持'

  if (type === 'text') {
    return (
      <>
        <CapabilityBadge
          icon={Wrench}
          label={`Tools ${supportsTools == null ? '未知' : supportsTools ? '支持' : '不支持'}`}
          tone={supportsTools == null ? 'neutral' : supportsTools ? 'success' : 'danger'}
        />
        <CapabilityBadge
          icon={Brain}
          label={`Thinking ${supportsThinking == null ? '未知' : supportsThinking ? '是' : '否'}`}
          tone={supportsThinking == null ? 'neutral' : supportsThinking ? 'success' : 'warning'}
        />
        <CapabilityBadge
          icon={Eye}
          label={`图片->文本 ${supportsVision == null ? '未知' : supportsVision ? '支持' : '不支持'}`}
          tone={supportsVision == null ? 'neutral' : supportsVision ? 'success' : 'warning'}
        />
      </>
    )
  }

  if (type === 'image') {
    return (
      <>
        <CapabilityBadge
          icon={ImageIcon}
          label={`文生图 ${supportsImageGeneration == null ? '未知' : supportsImageGeneration ? positiveLabel : negativeLabel}`}
          tone={supportsImageGeneration == null ? 'neutral' : supportsImageGeneration ? 'success' : 'danger'}
        />
        <CapabilityBadge
          icon={ImageIcon}
          label={imageMinSize ? `最小尺寸 ≥ ${imageMinSize}` : '最小尺寸 未返回限制'}
          tone="neutral"
        />
      </>
    )
  }

  if (type === 'video') {
    return (
      <CapabilityBadge
        icon={Video}
        label={`${videoLabelPrefix} ${supportsVideoGeneration == null ? '未知' : supportsVideoGeneration ? positiveLabel : negativeLabel}`}
        tone={supportsVideoGeneration == null ? 'neutral' : supportsVideoGeneration ? 'success' : 'danger'}
      />
    )
  }

  return null
}
