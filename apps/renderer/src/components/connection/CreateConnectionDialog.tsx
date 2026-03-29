import { useState, useEffect, useMemo } from 'react'
import { Loader2, Plus, Trash2, Github, ChevronRight, ChevronLeft, ChevronDown, Box, Ellipsis, Route, Hash, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  useSavedConnectionStore,
  TAG_OPTIONS,
  COLOR_OPTIONS,
  type SavedConnection,
} from '@/stores/savedConnectionStore'
import { connectTCP, disconnectTCP } from '@/services/api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import {
  FRAME_TEMPLATES,
  loadCustomTemplates,
  saveCustomTemplate,
  formatFramePreview,
  type FrameField,
  type FrameTemplate,
  type FrameConfig,
  type ByteOrder,
} from '@/types/frame'

interface CreateConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editConnection?: SavedConnection | null
  preset?: 'tophero-thrift-tcp' | null
}

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-4">
      {[1, 2, 3, 4].map((s) => (
        <div
          key={s}
          className={cn(
            'h-1 rounded-full transition-all',
            s === step
              ? 'w-6 bg-primary'
              : s < step
                ? 'w-3 bg-primary/40'
                : 'w-3 bg-muted'
          )}
        />
      ))}
    </div>
  )
}

export function CreateConnectionDialog({
  open,
  onOpenChange,
  editConnection,
  preset,
}: CreateConnectionDialogProps) {
  const addConnection = useSavedConnectionStore((s) => s.addConnection)
  const updateConnection = useSavedConnectionStore((s) => s.updateConnection)

  // wizard state
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [frameType, setFrameType] = useState<'template' | 'saved' | 'custom'>('template')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [customFields, setCustomFields] = useState<FrameField[]>([
    { name: '', bytes: 4 },
  ])
  const [byteOrder, setByteOrder] = useState<ByteOrder>('big')
  const [cherryParser, setCherryParser] = useState<'simple' | 'pomelo'>('simple')

const NAME_QUOTES = [
  '别人上班挣钱，我上班凑活活着',
  '每天都在努力，努力不努力',
  '我的精神状态：间歇性正常，持续性发疯',
  '钱没挣到，觉没睡好，快乐倒是离家出走了',
  '别烦我，我正在和摆烂做激烈思想斗争',
  '闹钟一响，我就想和全世界请个假',
  '人生建议：别听建议，开心最重要',
  '我不是胖，我是可爱到膨胀',
  '脑子：我会了 手：不，你不会',
  '除了干饭，其他事都提不起兴趣',
  '我的社交状态：想聊天又不想理人',
  '摆烂归摆烂，饭还是要按时吃',
  '别人脱单我脱发，别人暴富我暴瘦',
  '每天的心情：想下班，非常想下班',
  '我不是懒，我只是在节能模式',
  '理想生活：不上班，还有钱',
  '别骂我，骂我我就当场撒娇',
  '我的优点：知错就改，改了再犯',
  '快乐其实很简单，简单就不快乐了',
  '熬夜冠军申请出战，谁也别和我抢',
  '减肥计划：明天开始，永远明天',
  '我很好，除了没钱没觉没对象',
  '上班的意义：为了下班',
  '我的脑子：空空如也但很骄傲',
  '人生三大难题：吃啥、穿啥、几点睡',
  '别卷了，再卷我就卷成麻花',
  '情绪稳定？偶尔，大部分在发疯',
  '我不是普通废物，是限量版废物',
  '只要我躺得够平，压力就追不上我',
  '快乐秘籍：少想破事，多干饭'
]
  const namePlaceholder = useMemo(() => NAME_QUOTES[Math.floor(Math.random() * NAME_QUOTES.length)], [open])

  // form state
  const [name, setName] = useState('')
  const [tag, setTag] = useState('本地')
  const [host, setHost] = useState('')
  const [port, setPort] = useState<number | ''>('')
  const [protocol, setProtocol] = useState<'tcp' | 'ws'>('tcp')
  const [codec, setCodec] = useState<'protobuf' | 'thrift'>('protobuf')
  const [color, setColor] = useState<string>(COLOR_OPTIONS[0])
  const [testing, setTesting] = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [savedTemplates, setSavedTemplates] = useState<FrameTemplate[]>([])

  const isEdit = !!editConnection

  useEffect(() => {
    if (open) return

    const unlockBody = () => {
      document.body.style.pointerEvents = ''
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
      document.body.removeAttribute('data-scroll-locked')
    }

    unlockBody()
    const timer = window.setTimeout(unlockBody, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (open) {
      if (editConnection) {
        setName(editConnection.name)
        setTag(editConnection.tag)
        setHost(editConnection.host)
        setPort(editConnection.port)
        setProtocol(editConnection.protocol ?? 'tcp')
        setCodec(editConnection.codec ?? 'protobuf')
        setColor(editConnection.color)
        setStep(4)
      } else if (preset === 'tophero-thrift-tcp') {
        setName('')
        setTag('本地')
        setHost('')
        setPort(8801)
        setProtocol('tcp')
        setCodec('thrift')
        setColor(COLOR_OPTIONS[0])
        setStep(4)
        setFrameType('template')
        setSelectedTemplateId('tophero')
        setCustomFields([{ name: '', bytes: 4 }])
        setByteOrder('big')
        setCherryParser('simple')
      } else {
        setName('')
        setTag('本地')
        setHost('')
        setPort('')
        setProtocol('tcp')
        setCodec('protobuf')
        setColor(COLOR_OPTIONS[0])
        setStep(1)
        setFrameType('template')
        setSelectedTemplateId(null)
        setCustomFields([{ name: '', bytes: 4 }])
        setByteOrder('big')
        setCherryParser('simple')
      }
      setTesting(false)
      setShowSaveTemplate(false)
      setTemplateName('')
    }
  }, [open, editConnection, preset])

  useEffect(() => {
    if (step === 2 && frameType === 'saved') {
      loadCustomTemplates().then(setSavedTemplates)
    }
  }, [step, frameType])

  const resolveFrameConfig = (): FrameConfig => {
    if (frameType === 'template') {
      const tpl = FRAME_TEMPLATES.find((t) => t.id === selectedTemplateId)
      if (tpl) {
        if (tpl.id === 'tophero') {
          return { type: 'template', templateId: tpl.id, fields: tpl.fields, byteOrder: 'big', parserMode: 'tophero' }
        }
        if (tpl.id === 'cherry') {
          const fields = cherryParser === 'simple'
            ? [{ name: 'mid', bytes: 4, isRoute: true }, { name: 'len', bytes: 4 }]
            : [{ name: 'type', bytes: 1 }, { name: 'length', bytes: 3 }]
          return { type: 'template', templateId: tpl.id, fields, byteOrder: 'big', parserMode: cherryParser }
        }
        return { type: 'template', templateId: tpl.id, fields: tpl.fields, byteOrder: 'big' }
      }
    }

    if (frameType === 'saved') {
      const tpl = savedTemplates.find((t) => t.id === selectedTemplateId)
      if (tpl) {
        return { type: 'template', templateId: tpl.id, fields: tpl.fields, byteOrder: tpl.byteOrder ?? 'big' }
      }
    }

    if (frameType === 'custom') {
      return { type: 'custom', fields: customFields, byteOrder }
    }

    if (editConnection?.frameConfig) {
      return editConnection.frameConfig
    }

    return { type: 'custom', fields: [], byteOrder: 'big' }
  }

  const handleTest = async () => {
    const targetHost = host.trim()
    const portNum = Number(port)
    if (!targetHost || !portNum) {
      toast.error('Please enter host and port')
      return
    }

    const frameConfig = resolveFrameConfig()

    setTesting(true)
    try {
      await connectTCP(targetHost, portNum, {
        protocol,
        timeout: 5000,
        reconnect: false,
        heartbeat: false,
        frameFields: frameConfig.fields,
        byteOrder: frameConfig.byteOrder,
        parserMode: frameConfig.parserMode,
      })
      toast.message('Connection succeeded', {
        description: `${protocol.toUpperCase()} ${targetHost}:${portNum}`,
      })
      await disconnectTCP()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const hints: string[] = []

      if (targetHost === '0.0.0.0') {
        hints.push('Hint: 0.0.0.0 is a listen address, not a dial target. Try 127.0.0.1 or your LAN IP.')
      }
      if (protocol === 'ws') {
        hints.push('Hint: WS test only supports ws://host:port. If the server needs /ws or another path, it will fail.')
      }

      toast.error('Connection failed', {
        description: [`${protocol.toUpperCase()} ${targetHost}:${portNum}`, detail, ...hints].join(' | '),
      })
    } finally {
      setTesting(false)
    }
  }

  const buildFrameConfig = (): FrameConfig => {
    return resolveFrameConfig()
  }

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('请输入连接名称')
      return
    }
    if (!host.trim()) {
      toast.error('请输入地址')
      return
    }
    const portNum = Number(port)
    if (!portNum || portNum < 1 || portNum > 65535) {
      toast.error('请输入有效端口 (1-65535)')
      return
    }

    if (editConnection) {
      updateConnection(editConnection.id, {
        name: name.trim(),
        tag,
        host: host.trim(),
        port: portNum,
        protocol,
        codec,
        color,
      })
      toast.message('连接已更新')
      onOpenChange(false)
    } else {
      addConnection({
        name: name.trim(),
        tag,
        host: host.trim(),
        port: portNum,
        protocol,
        codec,
        color,
        frameConfig: buildFrameConfig(),
      })
      toast.message('连接已保存')
      if (frameType === 'custom') {
        setShowSaveTemplate(true)
      } else {
        onOpenChange(false)
      }
    }
  }

  const canProceedStep2 = () => {
    if (frameType === 'template' || frameType === 'saved') {
      return selectedTemplateId !== null
    }
    return customFields.length > 0 && customFields.every((f) => f.name.trim() && f.bytes > 0) && customFields.some((f) => f.isRoute)
  }

  const handleAddField = () => {
    setCustomFields([...customFields, { name: '', bytes: 1 }])
  }

  const handleRemoveField = (index: number) => {
    setCustomFields(customFields.filter((_, i) => i !== index))
  }

  const handleFieldChange = (index: number, key: keyof FrameField, value: string | number | boolean) => {
    setCustomFields(customFields.map((f, i) =>
      i === index ? { ...f, [key]: value } : f
    ))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'p-0 border-0 bg-transparent shadow-none gap-0',
          step >= 3 || showSaveTemplate ? 'sm:max-w-md' : 'sm:max-w-lg'
        )}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">
          {isEdit ? 'Edit Connection' : 'Create Connection'}
        </DialogTitle>
        {/* Save template confirmation */}
        {showSaveTemplate && (
          <Card>
            <CardHeader>
              <CardTitle>保存为模板？</CardTitle>
              <CardDescription>
                将当前自定义协议帧结构保存为模板，方便下次创建连接时直接使用
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <Field>
                  <FieldLabel htmlFor="template-name">模板名称</FieldLabel>
                  <Input
                    id="template-name"
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="输入模板名称"
                  />
                </Field>
                <div className="text-xs text-muted-foreground px-1">
                  帧结构：{formatFramePreview(customFields.filter((f) => f.name.trim() && f.bytes > 0))}
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                onClick={async () => {
                  if (!templateName.trim()) {
                    toast.error('请输入模板名称')
                    return
                  }
                  try {
                    await saveCustomTemplate(
                      templateName.trim(),
                      customFields.filter((f) => f.name.trim() && f.bytes > 0),
                      byteOrder
                    )
                    toast.message('模板已保存')
                    onOpenChange(false)
                  } catch {
                    toast.error('模板保存失败')
                  }
                }}
              >
                保存
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 1: Choose frame format type */}
        {!showSaveTemplate && step === 1 && (
          <Card>
            <CardHeader>
              <StepIndicator step={1} />
              <CardTitle>选择协议帧格式</CardTitle>
              <CardDescription>
                选择使用已有框架的协议帧模板，或自定义协议帧结构
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setFrameType('template')}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                    frameType === 'template'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/50'
                  )}
                >
                  <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-current">
                    {frameType === 'template' && (
                      <div className="h-2 w-2 rounded-full bg-current" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">协议帧模板</div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      使用已有游戏服务器框架的协议帧格式，开箱即用
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setFrameType('saved')}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                    frameType === 'saved'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/50'
                  )}
                >
                  <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-current">
                    {frameType === 'saved' && (
                      <div className="h-2 w-2 rounded-full bg-current" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">已保存的模板</div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      使用之前保存的自定义协议帧模板
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setFrameType('custom')}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                    frameType === 'custom'
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/50'
                  )}
                >
                  <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-current">
                    {frameType === 'custom' && (
                      <div className="h-2 w-2 rounded-full bg-current" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">自定义协议帧</div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      手动定义协议帧的字段名和字节数，适配自研协议
                    </div>
                  </div>
                </button>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => setStep(2)}>
                下一步
                <ChevronRight className="w-4 h-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 2a: Template selection */}
        {!showSaveTemplate && step === 2 && frameType === 'template' && (
          <Card>
            <CardHeader>
              <StepIndicator step={2} />
              <CardTitle>选择协议帧模板</CardTitle>
              <CardDescription>
                选择一个框架模板，将使用其协议帧格式进行通信
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col divide-y rounded-lg border">
                {FRAME_TEMPLATES.map((tpl) => {
                  const selected = selectedTemplateId === tpl.id
                  const available = tpl.id === 'due' || tpl.id === 'cherry' || tpl.id === 'tophero'
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => available && setSelectedTemplateId(tpl.id)}
                      disabled={!available}
                      className={cn(
                        'flex items-center gap-3 p-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg',
                        !available && 'opacity-50 cursor-not-allowed',
                        available && (selected ? 'bg-primary/5' : 'hover:bg-accent/50')
                      )}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Github className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <a
                          href={tpl.github}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-sm text-primary hover:underline"
                        >
                          {tpl.name}
                        </a>
                        <div className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                          {formatFramePreview(tpl.fields)}
                        </div>
                      </div>
                      {available ? (
                        <Badge variant={selected ? 'default' : 'outline'} className="shrink-0">
                          {selected ? '已选择' : '选择'}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="shrink-0">
                          敬请期待
                        </Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4" />
                上一步
              </Button>
              <Button onClick={() => setStep(3)} disabled={!selectedTemplateId}>
                下一步
                <ChevronRight className="w-4 h-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 2: Saved templates */}
        {!showSaveTemplate && step === 2 && frameType === 'saved' && (
          <Card>
            <CardHeader>
              <StepIndicator step={2} />
              <CardTitle>已保存的模板</CardTitle>
              <CardDescription>
                选择一个之前保存的自定义协议帧模板
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                if (savedTemplates.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Box className="h-10 w-10 text-muted-foreground/40 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        暂无已保存的模板
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        创建自定义协议帧时可保存为模板
                      </p>
                    </div>
                  )
                }
                return (
                  <div className="flex flex-col divide-y rounded-lg border">
                    {savedTemplates.map((tpl) => {
                      const selected = selectedTemplateId === tpl.id
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => setSelectedTemplateId(tpl.id)}
                          className={cn(
                            'flex items-center gap-3 p-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg',
                            selected ? 'bg-primary/5' : 'hover:bg-accent/50'
                          )}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Box className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-sm">{tpl.name}</span>
                            <div className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                              {formatFramePreview(tpl.fields)}
                            </div>
                          </div>
                          <Badge variant={selected ? 'default' : 'outline'} className="shrink-0">
                            {selected ? '已选择' : '选择'}
                          </Badge>
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4" />
                上一步
              </Button>
              <Button onClick={() => setStep(3)} disabled={!selectedTemplateId}>
                下一步
                <ChevronRight className="w-4 h-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 2b: Custom frame fields */}
        {!showSaveTemplate && step === 2 && frameType === 'custom' && (
          <Card>
            <CardHeader>
              <StepIndicator step={2} />
              <CardTitle>自定义协议帧</CardTitle>
              <CardDescription>
                定义协议帧的字段结构，字段按顺序排列组成完整帧
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-1 rounded-lg border p-1 ml-[calc(2px+var(--spacing)*2)]">
                  <button
                    type="button"
                    onClick={() => setByteOrder('big')}
                    className={cn(
                      'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      byteOrder === 'big'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    大端序 (Big-Endian)
                  </button>
                  <button
                    type="button"
                    onClick={() => setByteOrder('little')}
                    className={cn(
                      'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      byteOrder === 'little'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    小端序 (Little-Endian)
                  </button>
                </div>
                {customFields.map((field, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-center gap-2 rounded-md pl-2 border-l-2 transition-colors',
                      field.isRoute ? 'border-l-primary bg-primary/5'
                        : field.isSeq ? 'border-l-amber-500 bg-amber-500/5'
                        : 'border-l-transparent'
                    )}
                  >
                    <Input
                      className="flex-1"
                      placeholder="字段名"
                      value={field.name}
                      onChange={(e) => handleFieldChange(i, 'name', e.target.value)}
                    />
                    <div className="flex items-center gap-1">
                      <Input
                        className="w-20"
                        type="number"
                        min={1}
                        placeholder="字节"
                        value={field.bytes}
                        onChange={(e) => handleFieldChange(i, 'bytes', parseInt(e.target.value) || 0)}
                      />
                      <span className="text-sm text-muted-foreground w-3">B</span>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8">
                          <Ellipsis className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-28">
                        <DropdownMenuItem onClick={() => {
                          const newFields = [...customFields]
                          newFields[i] = { ...newFields[i], isRoute: !field.isRoute, isSeq: false }
                          setCustomFields(newFields)
                        }}>
                          <Route className="h-3.5 w-3.5" />
                          {field.isRoute ? '取消路由' : '标记路由'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => {
                          const newFields = [...customFields]
                          newFields[i] = { ...newFields[i], isSeq: !field.isSeq, isRoute: false }
                          setCustomFields(newFields)
                        }}>
                          <Hash className="h-3.5 w-3.5" />
                          {field.isSeq ? '取消序号' : '标记序号'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={customFields.length <= 1}
                          onClick={() => handleRemoveField(i)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit ml-[calc(2px+var(--spacing)*2)]"
                  onClick={handleAddField}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加字段
                </Button>
                {customFields.some((f) => f.name.trim() && f.bytes > 0) && (
                  <div className="text-xs text-muted-foreground mt-1 px-1">
                    帧结构预览：{formatFramePreview(customFields.filter((f) => f.name.trim() && f.bytes > 0))}
                  </div>
                )}
                {customFields.some((f) => f.name.trim() && f.bytes > 0) && !customFields.some((f) => f.isRoute) && (
                  <Alert className="border-transparent bg-gradient-to-r from-amber-500/10 to-transparent">
                    <TriangleAlert className="h-4 w-4 text-amber-500" />
                    <AlertDescription>
                      需要至少标记一个字段为路由，用于消息的分发与匹配。点击字段右侧的菜单按钮进行标记。
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4" />
                上一步
              </Button>
              <Button onClick={() => setStep(3)} disabled={!canProceedStep2()}>
                下一步
                <ChevronRight className="w-4 h-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 3: Protocol configuration */}
        {!showSaveTemplate && step === 3 && (
          <Card>
            <CardHeader>
              <StepIndicator step={3} />
              <CardTitle>协议配置</CardTitle>
              <CardDescription>
                配置网络传输协议和数据编解码方式
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <Field>
                  <FieldLabel>网络协议</FieldLabel>
                  <div className="flex items-center gap-1 rounded-lg border p-1">
                    <button
                      type="button"
                      onClick={() => setProtocol('tcp')}
                      className={cn(
                        'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                        protocol === 'tcp'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      TCP
                    </button>
                    <button
                      type="button"
                      onClick={() => setProtocol('ws')}
                      className={cn(
                        'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                        protocol === 'ws'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      WebSocket
                    </button>
                  </div>
                </Field>
                <Field>
                  <FieldLabel>编解码协议</FieldLabel>
                  <div className="flex items-center gap-1 rounded-lg border p-1">
                    <button
                      type="button"
                      onClick={() => setCodec('protobuf')}
                      className={cn(
                        'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                        codec === 'protobuf'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Protobuf
                    </button>
                    <button
                      type="button"
                      onClick={() => setCodec('thrift')}
                      className={cn(
                        'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                        codec === 'thrift'
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Thrift
                    </button>
                    <button
                      type="button"
                      disabled
                      className="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors text-muted-foreground/50 cursor-not-allowed"
                    >
                      JSON
                    </button>
                  </div>
                  <FieldDescription>JSON 编解码即将支持</FieldDescription>
                </Field>
                {selectedTemplateId === 'cherry' && (
                  <Field>
                    <FieldLabel>解析器模式</FieldLabel>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setCherryParser('simple')}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                          cherryParser === 'simple'
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-accent/50'
                        )}
                      >
                        <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-current">
                          {cherryParser === 'simple' && (
                            <div className="h-2 w-2 rounded-full bg-current" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-sm">Simple</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            简单二进制协议 — MID(4B) + DataLen(4B) + Data
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCherryParser('pomelo')}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                          cherryParser === 'pomelo'
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-accent/50'
                        )}
                      >
                        <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-current">
                          {cherryParser === 'pomelo' && (
                            <div className="h-2 w-2 rounded-full bg-current" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-sm">Pomelo</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            兼容 Pomelo 协议，支持路由压缩和数据压缩
                          </div>
                        </div>
                      </button>
                    </div>
                  </Field>
                )}
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                <ChevronLeft className="w-4 h-4" />
                上一步
              </Button>
              <Button onClick={() => setStep(4)}>
                下一步
                <ChevronRight className="w-4 h-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {/* Step 4: Connection form */}
        {!showSaveTemplate && step === 4 && (
          <Card>
            <CardHeader>
              {!isEdit && <StepIndicator step={4} />}
              <CardTitle>{isEdit ? '编辑连接' : '新建连接'}</CardTitle>
              <CardDescription>
                配置目标服务器的连接信息，保存后可在首页快速访问
              </CardDescription>
              {preset === 'tophero-thrift-tcp' && !isEdit && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge variant="secondary">TopHero</Badge>
                  <Badge variant="secondary">TCP</Badge>
                  <Badge variant="secondary">Thrift</Badge>

                </div>
              )}
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => { e.preventDefault(); handleSave() }}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="conn-name">连接名称</FieldLabel>
                    <Input
                      id="conn-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={namePlaceholder}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="conn-host">Host / IP</FieldLabel>
                    <Input
                      id="conn-host"
                      type="text"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="127.0.0.1"
                      required
                    />
                  </Field>
                  <div className="flex gap-4">
                    <Field className="flex-1">
                      <FieldLabel htmlFor="conn-port">端口</FieldLabel>
                      <Input
                        id="conn-port"
                        type="number"
                        min={1}
                        max={65535}
                        value={port}
                        onChange={(e) => setPort(e.target.value === '' ? '' : parseInt(e.target.value) || '')}
                        placeholder="8801"
                        required
                      />
                    </Field>
                    <Field className="flex-1">
                      <FieldLabel htmlFor="conn-tag">标签</FieldLabel>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button id="conn-tag" variant="outline" className="w-full justify-between font-normal">
                            {tag}
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
                          <DropdownMenuRadioGroup value={tag} onValueChange={setTag}>
                            {TAG_OPTIONS.map((t) => (
                              <DropdownMenuRadioItem key={t} value={t}>{t}</DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel>标识颜色</FieldLabel>
                    <div className="flex items-center gap-2">
                      {COLOR_OPTIONS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={cn(
                            'w-6 h-6 rounded-full transition-all',
                            color === c
                              ? 'ring-2 ring-ring ring-offset-2 ring-offset-background scale-110'
                              : 'opacity-60 hover:opacity-100 hover:scale-105'
                          )}
                          style={{ backgroundColor: c }}
                          onClick={() => setColor(c)}
                        />
                      ))}
                    </div>
                  </Field>
                  <FieldGroup>
                    <Field>
                      <Button type="submit" className="w-full">
                        保存连接
                      </Button>
                      <Button
                        variant="outline"
                        type="button"
                        className="w-full"
                        disabled={testing}
                        onClick={handleTest}
                      >
                        {testing && <Loader2 className="w-4 h-4 animate-spin" />}
                        {testing ? '测试中...' : '测试连接'}
                      </Button>
                    </Field>
                  </FieldGroup>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  )
}
