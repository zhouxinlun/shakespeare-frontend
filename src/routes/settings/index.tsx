import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  Save,
  Trash2,
  PlugZap,
  RotateCcw,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock3,
  type LucideIcon,
} from 'lucide-react'
import { settingApi } from '@/lib/api'
import { CapabilityBadges } from '@/components/settings/CapabilityBadges'
import { toErrMsg } from '@/lib/utils'
import { ModelMapSection } from '@/routes/settings/ModelMapSection'
import { PromptSection } from '@/routes/settings/PromptSection'
import { ProviderMappingSection } from '@/routes/settings/ProviderMappingSection'
import { StrategyEditor, type StrategyDraft } from '@/routes/settings/components/StrategyEditor'
import { useToastStore } from '@/stores/toast'
import type { AIConfig, AIModelMap, ProviderBaseURLMap } from '@/types/api'

const MANUFACTURERS = [
  'openai',
  'anthropic',
  'deepseek',
  'gemini',
  'xai',
  'qwen',
  'neuxnet',
  'zhipu',
  'volcengine',
  'other',
] as const

const CREATE_MANUFACTURERS = ['auto', ...MANUFACTURERS] as const
const CREATE_TYPES = [
  { value: 'text', label: 'text（文本/多模态对话）' },
  { value: 'image', label: 'image（文生图）' },
  { value: 'video', label: 'video（文生视频）' },
] as const

const MAP_EXPECTED_TYPE: Record<string, string> = {
  outlineScriptAgent: 'text',
  storyboardAgent: 'text',
  generateScript: 'text',
  assetsPrompt: 'text',
  assetsImage: 'image',
  videoPrompt: 'text',
}

const TYPE_SORT_RANK: Record<string, number> = {
  text: 0,
  image: 1,
  video: 2,
}

type ConfigForm = {
  type: string
  manufacturer: string
  model: string
  api_key: string
  base_url: string
}

type CreateForm = {
  type: string
  manufacturer: string
  model: string
  api_key: string
  base_url: string
}

type ProviderMapCreateForm = {
  manufacturer: string
  base_url_prefix: string
}

type DetectionResult = {
  detected_type?: string | null
  supports_tools?: boolean | null
  supports_thinking?: boolean | null
  supports_vision?: boolean | null
  supports_image_generation?: boolean | null
  image_min_size?: string | null
  supports_video_generation?: boolean | null
}

const TEST_COOLDOWN_MS = 5000

function toDraft(cfg: AIConfig): ConfigForm {
  return {
    type: cfg.type,
    manufacturer: cfg.manufacturer,
    model: cfg.model,
    api_key: cfg.api_key ?? '',
    base_url: cfg.base_url ?? '',
  }
}

function isSameConfigForm(a?: ConfigForm, b?: ConfigForm): boolean {
  if (!a || !b) return false
  return (
    a.type === b.type &&
    a.manufacturer === b.manufacturer &&
    a.model === b.model &&
    a.api_key === b.api_key &&
    a.base_url === b.base_url
  )
}

function formatTestTime(raw?: string | null): string {
  if (!raw) return '未测试'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '未测试'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function parseTime(raw?: string | null): number {
  if (!raw) return 0
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? 0 : t
}

type BadgeTone = 'success' | 'danger' | 'warning' | 'neutral'

function toneClass(tone: BadgeTone): string {
  if (tone === 'success') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
  if (tone === 'danger') return 'border-red-500/40 bg-red-500/10 text-red-400'
  if (tone === 'warning') return 'border-amber-500/40 bg-amber-500/10 text-amber-400'
  return 'border-border bg-muted/40 text-muted-foreground'
}

function CapabilityBadge({ icon: Icon, label, tone }: { icon: LucideIcon; label: string; tone: BadgeTone }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${toneClass(tone)}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}


type HeaderBadgeMeta = {
  label: string
  icon: LucideIcon
  shellClass: string
  valueClass: string
}

const TYPE_CONFIG: Record<string, { emoji: string; label: string }> = {
  text:  { emoji: '📄', label: 'Text' },
  image: { emoji: '🖼️', label: 'Image（文生图）' },
  video: { emoji: '🎬', label: 'Video' },
}

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.text
  return <span className="inline-flex items-center gap-1 text-sm">{cfg.emoji} <span className="text-xs">{cfg.label}</span></span>
}

function ProviderBadge({ provider }: { provider: string }) {
  const nameMap: Record<string, string> = {
    openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek',
    gemini: 'Gemini', xai: 'xAI', qwen: 'Qwen', neuxnet: 'Neuxnet',
    zhipu: 'Zhipu', volcengine: 'Volcengine', other: 'Other',
  }
  const normalized = (provider || '').toLowerCase()
  const label = nameMap[normalized] ?? (provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'Other')
  return <span className="text-xs text-muted-foreground">🔌 {label}</span>
}


export function SettingsPage() {
  const queryClient = useQueryClient()
  const [createForm, setCreateForm] = useState<CreateForm>({
    type: 'text',
    manufacturer: 'auto',
    model: '',
    api_key: '',
    base_url: '',
  })
  const [createDetect, setCreateDetect] = useState<DetectionResult | null>(null)
  const [providerMapCreateForm, setProviderMapCreateForm] = useState<ProviderMapCreateForm>({
    manufacturer: '',
    base_url_prefix: '',
  })
  const [editForms, setEditForms] = useState<Record<number, ConfigForm>>({})
  const editFormsRef = useRef<Record<number, ConfigForm>>({})
  const serverDraftByIdRef = useRef<Record<number, ConfigForm>>({})
  const [staleConfigById, setStaleConfigById] = useState<Record<number, boolean>>({})
  const [pendingConfigOps, setPendingConfigOps] = useState<Record<number, number>>({})
  const [draftTestCooling, setDraftTestCooling] = useState(false)
  const [savedTestCoolingById, setSavedTestCoolingById] = useState<Record<number, boolean>>({})
  const [mapDrafts, setMapDrafts] = useState<Record<string, string>>({})
  const [strategyDraft, setStrategyDraft] = useState<StrategyDraft | null>(null)
  const [draggingFallbackId, setDraggingFallbackId] = useState<number | null>(null)
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({})
  const [showApiKeyById, setShowApiKeyById] = useState<Record<number, boolean>>({})
  const showToast = useToastStore((s) => s.show)

  const { data: aiConfigs = [], isLoading: aiLoading } = useQuery({
    queryKey: ['settings-ai-configs'],
    queryFn: () => settingApi.getAIConfigs().then((r) => r.data),
  })

  const { data: modelMaps = [], isLoading: modelMapLoading } = useQuery({
    queryKey: ['settings-model-maps'],
    queryFn: () => settingApi.getModelMaps().then((r) => r.data),
  })

  const { data: providerBaseURLMaps = [], isLoading: providerMapLoading } = useQuery({
    queryKey: ['settings-provider-base-url-maps'],
    queryFn: () => settingApi.getProviderBaseURLMaps().then((r) => r.data),
  })

  const { data: prompts = [], isLoading: promptLoading } = useQuery({
    queryKey: ['settings-prompts'],
    queryFn: () => settingApi.getPrompts().then((r) => r.data),
  })

  useEffect(() => {
    editFormsRef.current = editForms
  }, [editForms])

  useEffect(() => {
    const prevForms = editFormsRef.current
    const prevServer = serverDraftByIdRef.current
    const nextForms: Record<number, ConfigForm> = {}
    const nextStale: Record<number, boolean> = {}
    const nextServer: Record<number, ConfigForm> = {}

    for (const cfg of aiConfigs) {
      const serverDraft = toDraft(cfg)
      const localDraft = prevForms[cfg.id]
      const previousServerDraft = prevServer[cfg.id]
      nextServer[cfg.id] = serverDraft

      if (!localDraft || !previousServerDraft) {
        nextForms[cfg.id] = serverDraft
        nextStale[cfg.id] = false
        continue
      }

      const dirty = !isSameConfigForm(localDraft, previousServerDraft)
      const serverChanged = !isSameConfigForm(previousServerDraft, serverDraft)
      if (!dirty) {
        nextForms[cfg.id] = serverDraft
        nextStale[cfg.id] = false
      } else {
        nextForms[cfg.id] = localDraft
        nextStale[cfg.id] = serverChanged
      }
    }

    serverDraftByIdRef.current = nextServer
    setEditForms(nextForms)
    setStaleConfigById(nextStale)
  }, [aiConfigs])

  useEffect(() => {
    if (!modelMaps.length) return
    setMapDrafts((prev) => {
      const next = { ...prev }
      for (const m of modelMaps) {
        next[m.key] = m.config_id == null ? '' : String(m.config_id)
      }
      return next
    })
  }, [modelMaps])

  useEffect(() => {
    if (!prompts.length) return
    setPromptDrafts((prev) => {
      const next = { ...prev }
      for (const p of prompts) {
        if (!(p.code in next)) next[p.code] = p.custom_value ?? ''
      }
      return next
    })
  }, [prompts])

  useEffect(() => {
    setCreateDetect(null)
  }, [createForm.type, createForm.manufacturer, createForm.model, createForm.api_key, createForm.base_url])

  const markConfigPending = (id: number) => {
    setPendingConfigOps((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
  }

  const unmarkConfigPending = (id: number) => {
    setPendingConfigOps((prev) => {
      const current = prev[id] ?? 0
      if (current <= 1) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: current - 1 }
    })
  }

  const createConfigMutation = useMutation({
    mutationFn: () =>
      settingApi.createAIConfig({
        type: createForm.type,
        manufacturer: createForm.manufacturer,
        model: createForm.model.trim(),
        api_key: createForm.api_key.trim(),
        base_url: createForm.base_url.trim() || undefined,
      }),
    onSuccess: (res) => {
      const created = res.data
      const submittedApiKey = createForm.api_key.trim()
      setEditForms((prev) => ({
        ...prev,
        [created.id]: {
          type: created.type,
          manufacturer: created.manufacturer,
          model: created.model,
          api_key: submittedApiKey,
          base_url: created.base_url ?? '',
        },
      }))
      queryClient.invalidateQueries({ queryKey: ['settings-ai-configs'] })
      setCreateDetect({
        detected_type: created.type,
        supports_tools: created.supports_tools,
        supports_thinking: created.supports_thinking,
        supports_vision: created.supports_vision,
        supports_image_generation: created.supports_image_generation,
        image_min_size: created.image_min_size,
        supports_video_generation: created.supports_video_generation,
      })
      // 保留 manufacturer/api_key/base_url，便于连续新增多个模型配置
      setCreateForm((prev) => ({ ...prev, model: '' }))
      if (created.last_test_status === 'failed') {
        showToast(`创建成功，但 ${created.type} 测试失败：${created.last_test_summary || '请点测试重试'}`, 'error', 8000)
      } else {
        showToast(`创建成功，类型 ${created.type} 测试通过`, 'success')
      }
    },
    onError: (err) => showToast(toErrMsg(err), 'error', 8000),
  })

  const testDraftMutation = useMutation({
    mutationFn: () =>
      settingApi.testDraftAIConfig({
        type: createForm.type,
        manufacturer: createForm.manufacturer,
        model: createForm.model.trim(),
        api_key: createForm.api_key.trim(),
        base_url: createForm.base_url.trim() || undefined,
      }),
    onSuccess: (res) => {
      setCreateDetect(res.data.data)
      showToast(
        `测试成功: ${res.data.data.detected_type ?? createForm.type}；${res.data.data.reply || 'OK'}`,
        'success',
        8000,
      )
    },
    onError: (err) => showToast(toErrMsg(err), 'error', 8000),
  })

  const updateConfigMutation = useMutation({
    mutationFn: (id: number) => {
      const form = editForms[id]
      return settingApi.updateAIConfig(id, {
        type: form.type,
        manufacturer: form.manufacturer,
        model: form.model.trim(),
        api_key: form.api_key.trim() || undefined,
        base_url: form.base_url.trim() || null,
      })
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['settings-ai-configs'] })
      setStaleConfigById((prev) => ({ ...prev, [id]: false }))
      showToast('保存成功', 'success')
    },
    onError: (err) => showToast(toErrMsg(err), 'error', 8000),
    onMutate: (id) => markConfigPending(id),
    onSettled: (_, __, id) => unmarkConfigPending(id),
  })

  const testSavedMutation = useMutation({
    mutationFn: (id: number) => settingApi.testSavedAIConfig(id),
    onSuccess: (res, id) => {
      queryClient.invalidateQueries({ queryKey: ['settings-ai-configs'] })
      showToast(`测试成功: ${res.data.data.reply || 'OK'}`, 'success', 8000)
    },
    onError: (err) => showToast(toErrMsg(err), 'error', 8000),
    onMutate: (id) => markConfigPending(id),
    onSettled: (_, __, id) => unmarkConfigPending(id),
  })

  const triggerDraftTest = () => {
    if (draftTestCooling) {
      showToast('测试请求过于频繁，请 5 秒后重试', 'info')
      return
    }
    setDraftTestCooling(true)
    window.setTimeout(() => setDraftTestCooling(false), TEST_COOLDOWN_MS)
    testDraftMutation.mutate()
  }

  const triggerSavedTest = (id: number) => {
    if (savedTestCoolingById[id]) {
      showToast('测试请求过于频繁，请 5 秒后重试', 'info')
      return
    }
    setSavedTestCoolingById((prev) => ({ ...prev, [id]: true }))
    window.setTimeout(() => {
      setSavedTestCoolingById((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }, TEST_COOLDOWN_MS)
    testSavedMutation.mutate(id)
  }

  const deleteConfigMutation = useMutation({
    mutationFn: (id: number) => settingApi.deleteAIConfig(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['settings-ai-configs'] })
      queryClient.invalidateQueries({ queryKey: ['settings-model-maps'] })
      showToast('删除成功', 'success')
    },
    onError: (err) => showToast(toErrMsg(err), 'error', 8000),
    onMutate: (id) => markConfigPending(id),
    onSettled: (_, __, id) => unmarkConfigPending(id),
  })

  const createProviderMapMutation = useMutation({
    mutationFn: () =>
      settingApi.createProviderBaseURLMap({
        manufacturer: providerMapCreateForm.manufacturer,
        base_url_prefix: providerMapCreateForm.base_url_prefix.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-provider-base-url-maps'] })
      setProviderMapCreateForm((prev) => ({ ...prev, base_url_prefix: '' }))
      showToast('映射创建成功', 'success')
    },
    onError: (err) => showToast(toErrMsg(err), 'error', 8000),
  })

  const deleteProviderMapMutation = useMutation({
    mutationFn: (id: number) => settingApi.deleteProviderBaseURLMap(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-provider-base-url-maps'] })
      showToast('映射删除成功', 'success')
    },
    onError: (err) => showToast(toErrMsg(err), 'error', 8000),
  })

  const updateMapMutation = useMutation({
    mutationFn: ({ key, configId, fallbackConfigIds }: { key: string; configId: number | null; fallbackConfigIds?: number[] }) =>
      settingApi.updateModelMap(key, {
        config_id: configId,
        ...(fallbackConfigIds !== undefined ? { fallback_config_ids: fallbackConfigIds } : {}),
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['settings-model-maps'] })
      if (vars.fallbackConfigIds !== undefined) {
        setStrategyDraft(null)
        showToast('备用链策略已更新', 'success')
      } else {
        showToast('映射已更新', 'success')
      }
    },
    onError: (err) => showToast(toErrMsg(err), 'error', 8000),
  })

  const updatePromptMutation = useMutation({
    mutationFn: ({ code, value }: { code: string; value: string | null }) => settingApi.updatePrompt(code, value),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['settings-prompts'] })
      showToast('已保存', 'success')
    },
    onError: (err) => showToast(toErrMsg(err), 'error', 8000),
  })

  const modelMapWithOptions = useMemo(() => {
    return modelMaps
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((m) => {
        const expectedType = MAP_EXPECTED_TYPE[m.key]
        const options = expectedType ? aiConfigs.filter((c) => c.type === expectedType) : aiConfigs
        return { map: m, expectedType, options }
      })
  }, [modelMaps, aiConfigs])

  const aiConfigById = useMemo(
    () =>
      aiConfigs.reduce<Record<number, AIConfig>>((acc, cfg) => {
        acc[cfg.id] = cfg
        return acc
      }, {}),
    [aiConfigs],
  )

  const strategyOptions = useMemo(() => {
    if (!strategyDraft) return []
    const row = modelMapWithOptions.find((item) => item.map.key === strategyDraft.key)
    return row?.options ?? []
  }, [strategyDraft, modelMapWithOptions])

  const strategyAddOptions = useMemo(() => {
    if (!strategyDraft) return []
    const used = new Set(strategyDraft.chain)
    return strategyOptions.filter((cfg) => !used.has(cfg.id))
  }, [strategyDraft, strategyOptions])

  const openStrategyEditor = (map: AIModelMap, options: AIConfig[]) => {
    const draftPrimary = mapDrafts[map.key]
    const resolvedPrimary = draftPrimary ? Number(draftPrimary) : map.config_id ?? null
    if (!resolvedPrimary) {
      showToast('请先绑定主模型，再配置 fallback 链', 'error')
      return
    }

    const chain: number[] = []
    const seen = new Set<number>()
    for (const cid of [resolvedPrimary, ...(map.fallback_config_ids ?? [])]) {
      if (!Number.isInteger(cid)) continue
      if (seen.has(cid)) continue
      chain.push(cid)
      seen.add(cid)
    }
    if (!chain.length) chain.push(resolvedPrimary)

    setStrategyDraft({
      key: map.key,
      name: map.name,
      expectedType: MAP_EXPECTED_TYPE[map.key],
      chain,
      addCandidateId: '',
    })

    // 兜底：若 options 为空时也允许编辑已有链（例如旧配置被删除）
    if (!options.length && chain.length <= 1) {
      showToast('当前没有可添加的同类型备用模型', 'info')
    }
  }

  const removeFallbackFromStrategy = (configId: number) => {
    setStrategyDraft((prev) => {
      if (!prev) return prev
      const nextChain = prev.chain.filter((cid, index) => index === 0 || cid !== configId)
      return { ...prev, chain: nextChain }
    })
  }

  const addFallbackToStrategy = () => {
    if (!strategyDraft?.addCandidateId) return
    const configId = Number(strategyDraft.addCandidateId)
    if (!Number.isInteger(configId)) return
    setStrategyDraft((prev) => {
      if (!prev || prev.chain.includes(configId)) return prev
      return { ...prev, chain: [...prev.chain, configId], addCandidateId: '' }
    })
  }

  const reorderFallbackInStrategy = (draggedId: number, targetId: number) => {
    setStrategyDraft((prev) => {
      if (!prev) return prev
      const from = prev.chain.indexOf(draggedId)
      const to = prev.chain.indexOf(targetId)
      // 主模型固定在首位，只允许重排 fallback 列表
      if (from <= 0 || to <= 0 || from === to) return prev
      const next = prev.chain.slice()
      next.splice(to, 0, ...next.splice(from, 1))
      return { ...prev, chain: next }
    })
  }

  const saveStrategyDraft = () => {
    if (!strategyDraft) return
    const primaryId = strategyDraft.chain[0]
    if (!primaryId) {
      showToast('主模型不能为空', 'error')
      return
    }
    updateMapMutation.mutate({
      key: strategyDraft.key,
      configId: primaryId,
      fallbackConfigIds: strategyDraft.chain.slice(1),
    })
  }

  const sortedAIConfigs = useMemo(() => {
    const statusRank = (status?: string | null): number => {
      if (status === 'failed') return 0
      if (status === 'passed') return 2
      return 1
    }

    return aiConfigs.slice().sort((a, b) => {
      const byStatus = statusRank(a.last_test_status) - statusRank(b.last_test_status)
      if (byStatus !== 0) return byStatus

      const byType = (TYPE_SORT_RANK[a.type] ?? 99) - (TYPE_SORT_RANK[b.type] ?? 99)
      if (byType !== 0) return byType

      const byTestedAt = parseTime(b.last_tested_at) - parseTime(a.last_tested_at)
      if (byTestedAt !== 0) return byTestedAt

      const byCreatedAt = parseTime(b.created_at) - parseTime(a.created_at)
      if (byCreatedAt !== 0) return byCreatedAt

      return b.id - a.id
    })
  }, [aiConfigs])

  const canSubmitCreate = Boolean(createForm.model.trim() && createForm.api_key.trim())
  const providerBaseURLRows = useMemo(
    () =>
      providerBaseURLMaps
        .slice()
        .sort((a: ProviderBaseURLMap, b: ProviderBaseURLMap) => a.manufacturer.localeCompare(b.manufacturer) || a.base_url_prefix.localeCompare(b.base_url_prefix)),
    [providerBaseURLMaps],
  )

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">系统设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理 LLM / 图像 / 视频配置、Agent 模型映射与提示词</p>
      </div>

      <ProviderMappingSection
        manufacturers={MANUFACTURERS}
        manufacturer={providerMapCreateForm.manufacturer}
        baseUrlPrefix={providerMapCreateForm.base_url_prefix}
        onManufacturerChange={(value) => setProviderMapCreateForm((s) => ({ ...s, manufacturer: value }))}
        onBaseUrlPrefixChange={(value) => setProviderMapCreateForm((s) => ({ ...s, base_url_prefix: value }))}
        onCreate={() => {
          if (!providerMapCreateForm.manufacturer.trim()) {
            showToast('请先选择供应商', 'error')
            return
          }
          if (!providerMapCreateForm.base_url_prefix.trim()) {
            showToast('请先填写 Base URL 前缀', 'error')
            return
          }
          createProviderMapMutation.mutate()
        }}
        createPending={createProviderMapMutation.isPending}
        providerMapLoading={providerMapLoading}
        providerBaseURLRows={providerBaseURLRows}
        isDeleting={(id) => deleteProviderMapMutation.isPending && deleteProviderMapMutation.variables === id}
        onDelete={(row) => {
          if (!window.confirm(`确认删除映射 ${row.manufacturer} -> ${row.base_url_prefix}？`)) return
          deleteProviderMapMutation.mutate(row.id)
        }}
      />

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">AI 配置</h2>
        <p className="mt-1 text-xs text-muted-foreground">新增配置时请先指定类型；text / image / video 将按对应探针测试</p>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <select
            value={createForm.type}
            onChange={(e) => setCreateForm((s) => ({ ...s, type: e.target.value }))}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {CREATE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <select
            value={createForm.manufacturer}
            onChange={(e) => setCreateForm((s) => ({ ...s, manufacturer: e.target.value }))}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {CREATE_MANUFACTURERS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input
            value={createForm.model}
            onChange={(e) => setCreateForm((s) => ({ ...s, model: e.target.value }))}
            placeholder="model"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />

          <input
            type="password"
            value={createForm.api_key}
            onChange={(e) => setCreateForm((s) => ({ ...s, api_key: e.target.value }))}
            placeholder="api_key"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />

          <input
            value={createForm.base_url}
            onChange={(e) => setCreateForm((s) => ({ ...s, base_url: e.target.value }))}
            placeholder="base_url (optional)"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={triggerDraftTest}
            disabled={!canSubmitCreate || testDraftMutation.isPending || draftTestCooling}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {testDraftMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
            {draftTestCooling ? '测试冷却中' : '测试新配置'}
          </button>
          <button
            onClick={() => createConfigMutation.mutate()}
            disabled={!canSubmitCreate || createConfigMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {createConfigMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            新增配置
          </button>
        </div>

        {createDetect && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <CapabilityBadge icon={CheckCircle2} label={`类型 ${createDetect.detected_type ?? createForm.type}`} tone="success" />
            <CapabilityBadges
              type={createForm.type}
              supportsTools={createDetect.supports_tools}
              supportsThinking={createDetect.supports_thinking}
              supportsVision={createDetect.supports_vision}
              supportsImageGeneration={createDetect.supports_image_generation}
              imageMinSize={createDetect.image_min_size}
              supportsVideoGeneration={createDetect.supports_video_generation}
              videoLabelPrefix="生视频"
              valueStyle="support"
            />
          </div>
          )}

        <div className="mt-5 space-y-3">
          {aiLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />加载中...</div>
          ) : aiConfigs.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无配置</div>
          ) : sortedAIConfigs.map((cfg) => {
            const form = editForms[cfg.id] ?? toDraft(cfg)
            const testStatus = cfg.last_test_status
            const canEditType = testStatus !== 'passed'
            const statusMeta =
              testStatus === 'passed'
                ? { icon: CheckCircle2, label: '最近测试通过', tone: 'success' as const }
                : testStatus === 'failed'
                  ? { icon: XCircle, label: '最近测试失败', tone: 'danger' as const }
                  : { icon: HelpCircle, label: '最近未测试', tone: 'neutral' as const }
            const busy = Boolean(pendingConfigOps[cfg.id])
            const testCooling = Boolean(savedTestCoolingById[cfg.id])
            return (
              <div key={cfg.id} className="rounded-lg border border-border/60 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <TypeBadge type={cfg.type} />
                  <ProviderBadge provider={cfg.manufacturer} />
                </div>
                <div className="grid gap-2 md:grid-cols-5">
                  <select
                    value={form.type}
                    onChange={(e) => setEditForms((s) => ({ ...s, [cfg.id]: { ...form, type: e.target.value } }))}
                    disabled={!canEditType}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                    title={canEditType ? '可修改类型' : '测试通过后类型已锁定'}
                  >
                    {CREATE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.value}</option>
                    ))}
                  </select>
                  <select
                    value={form.manufacturer}
                    onChange={(e) => setEditForms((s) => ({ ...s, [cfg.id]: { ...form, manufacturer: e.target.value } }))}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                  >
                    {MANUFACTURERS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <input
                    value={form.model}
                    onChange={(e) => setEditForms((s) => ({ ...s, [cfg.id]: { ...form, model: e.target.value } }))}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                  />
                  <div className="relative">
                    <input
                      type={showApiKeyById[cfg.id] ? 'text' : 'password'}
                      value={form.api_key}
                      onChange={(e) => setEditForms((s) => ({ ...s, [cfg.id]: { ...form, api_key: e.target.value } }))}
                      placeholder="api_key (留空不改)"
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 pr-8 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKeyById((s) => ({ ...s, [cfg.id]: !s[cfg.id] }))}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={showApiKeyById[cfg.id] ? '隐藏 API Key' : '显示 API Key'}
                      title={showApiKeyById[cfg.id] ? '隐藏 API Key' : '显示 API Key'}
                    >
                      {showApiKeyById[cfg.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <input
                    value={form.base_url}
                    onChange={(e) => setEditForms((s) => ({ ...s, [cfg.id]: { ...form, base_url: e.target.value } }))}
                    placeholder="base_url"
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                  />
                </div>

                <div className="mt-2 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <CapabilityBadge icon={statusMeta.icon} label={statusMeta.label} tone={statusMeta.tone} />
                    <CapabilityBadge icon={Clock3} label={`测试时间 ${formatTestTime(cfg.last_tested_at)}`} tone="neutral" />
                    <CapabilityBadges
                      type={cfg.type}
                      supportsTools={cfg.supports_tools}
                      supportsThinking={cfg.supports_thinking}
                      supportsVision={cfg.supports_vision}
                      supportsImageGeneration={cfg.supports_image_generation}
                      imageMinSize={cfg.image_min_size}
                      supportsVideoGeneration={cfg.supports_video_generation}
                      videoLabelPrefix="视频提交"
                      valueStyle="result"
                    />
                    {staleConfigById[cfg.id] && (
                      <CapabilityBadge icon={HelpCircle} label="服务端数据已更新，请重置或保存本地修改" tone="warning" />
                    )}
                  </div>
                  {cfg.last_test_summary && (
                    <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2">
                      <p className="text-xs text-muted-foreground line-clamp-2">{cfg.last_test_summary}</p>
                    </div>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => triggerSavedTest(cfg.id)}
                    disabled={busy || testCooling}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <PlugZap className="h-3.5 w-3.5" />{testCooling ? '测试冷却中' : '测试'}
                  </button>
                  <button
                    onClick={() => updateConfigMutation.mutate(cfg.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" />保存
                  </button>
                  <button
                    onClick={() => {
                      setEditForms((s) => ({ ...s, [cfg.id]: toDraft(cfg) }))
                      setStaleConfigById((s) => ({ ...s, [cfg.id]: false }))
                    }}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />重置
                  </button>
                  <button
                    onClick={() => {
                      if (!window.confirm(`确认删除配置 #${cfg.id} (${cfg.manufacturer}/${cfg.model})？`)) return
                      deleteConfigMutation.mutate(cfg.id)
                    }}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <ModelMapSection
        modelMapLoading={modelMapLoading}
        modelMapWithOptions={modelMapWithOptions}
        mapDrafts={mapDrafts}
        aiConfigById={aiConfigById}
        isMapBusy={(key) => updateMapMutation.isPending && updateMapMutation.variables?.key === key}
        onChangeDraft={(key, value) => setMapDrafts((s) => ({ ...s, [key]: value }))}
        onSaveMap={(key, value) =>
          updateMapMutation.mutate({
            key,
            configId: value ? Number(value) : null,
          })
        }
        onResetMap={(key, value) => setMapDrafts((s) => ({ ...s, [key]: value }))}
        onOpenStrategy={openStrategyEditor}
      />

      <StrategyEditor
        draft={strategyDraft}
        aiConfigById={aiConfigById}
        strategyAddOptions={strategyAddOptions}
        onClose={() => setStrategyDraft(null)}
        onDragStart={(configId, isPrimary, event) => {
          if (isPrimary) return
          event.dataTransfer.setData('text/plain', String(configId))
          event.dataTransfer.effectAllowed = 'move'
          setDraggingFallbackId(configId)
        }}
        onDragOver={(isPrimary, event) => {
          if (isPrimary) return
          event.preventDefault()
        }}
        onDrop={(targetId, event) => {
          event.preventDefault()
          const raw = event.dataTransfer.getData('text/plain')
          const dragged = Number(raw || draggingFallbackId || 0)
          if (!dragged) return
          reorderFallbackInStrategy(dragged, targetId)
          setDraggingFallbackId(null)
        }}
        onDragEnd={() => setDraggingFallbackId(null)}
        onRemoveFallback={removeFallbackFromStrategy}
        onChangeCandidate={(value) => setStrategyDraft((prev) => (prev ? { ...prev, addCandidateId: value } : prev))}
        onAddFallback={addFallbackToStrategy}
        onSave={saveStrategyDraft}
        saving={updateMapMutation.isPending}
      />

      <PromptSection
        promptLoading={promptLoading}
        prompts={prompts}
        promptDrafts={promptDrafts}
        isBusy={(code) => updatePromptMutation.isPending && updatePromptMutation.variables?.code === code}
        onChangeDraft={(code, value) => setPromptDrafts((s) => ({ ...s, [code]: value }))}
        onReset={(code) => {
          setPromptDrafts((s) => ({ ...s, [code]: '' }))
          updatePromptMutation.mutate({ code, value: null })
        }}
        onSave={(code, value) => updatePromptMutation.mutate({ code, value: value.trim() ? value : null })}
      />
    </div>
  )
}
