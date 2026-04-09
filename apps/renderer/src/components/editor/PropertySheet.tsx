import { Check, Copy } from 'lucide-react'
import { useCanvasStore, type BeginNodeData, type CommentNodeData } from '@/stores/canvasStore'
import { FieldEditor } from './FieldEditor'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStatusStore } from '@/stores/sessionStatusStore'
import { WaitResponseEditor } from './WaitResponseEditor'
import { RuntimeDataViewer } from './RuntimeDataViewer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

function ReadonlyCopyField({ label, value }: { label: string; value?: string }) {
  const displayValue = value && value.trim().length > 0 ? value : 'Not available yet'

  return (
    <div className="grid gap-1.5">
      <div className="text-xs font-medium text-foreground">{label}</div>
      <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
        <div className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{displayValue}</div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={!value}
          onClick={async () => {
            if (!value) return
            try {
              await navigator.clipboard.writeText(value)
              toast.success(`${label} copied`)
            } catch {
              toast.error(`Failed to copy ${label}`)
            }
          }}
        >
          {value ? <Copy className="size-3" /> : <Check className="size-3 opacity-0" />}
          Copy
        </Button>
      </div>
    </div>
  )
}

function BeginEditor({ nodeId }: { nodeId: string }) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const clearStatus = useSessionStatusStore((s) => s.clearStatus)

  if (!node || node.type !== 'beginNode') return null
  const data = node.data as BeginNodeData
  const deviceId = typeof data.deviceId === 'string' ? data.deviceId.trim() : ''
  const statusKey = activeConnectionId && deviceId ? `${activeConnectionId}::${deviceId}` : null
  const sessionRuntime = useSessionStatusStore((s) => (statusKey ? s.statuses[statusKey]?.runtime : undefined))

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor={`begin-device-${nodeId}`}>deviceId</Label>
        <Input
          id={`begin-device-${nodeId}`}
          value={data.deviceId ?? ''}
          onChange={(e) => {
            const nextDeviceId = e.target.value
            if (activeConnectionId && nextDeviceId.trim()) {
              clearStatus(activeConnectionId, nextDeviceId.trim())
            }
            updateNodeData(nodeId, { deviceId: nextDeviceId })
          }}
          placeholder="Enter deviceId for this chain"
          autoFocus
        />
        <div className="text-xs text-muted-foreground">
          登录的设备ID.
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/15 p-3">
        <div>
          <div className="text-sm font-medium text-foreground">Player Info</div>
          <div className="text-xs text-muted-foreground">
          </div>
        </div>
        <ReadonlyCopyField label="roleId" value={sessionRuntime?.roleId} />
        <ReadonlyCopyField label="allianceId" value={sessionRuntime?.allianceId} />
      </div>
    </div>
  )
}

function CommentEditor({ nodeId }: { nodeId: string }) {
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)

  if (!node || node.type !== 'commentNode') return null
  const data = node.data as CommentNodeData

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor={`comment-title-${nodeId}`}>Title</Label>
        <Input
          id={`comment-title-${nodeId}`}
          value={data.label}
          onChange={(e) => updateNodeData(nodeId, { label: e.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label>Color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={data.color || '#9B8E7B'}
            onChange={(e) => updateNodeData(nodeId, { color: e.target.value })}
            className="h-8 w-8 cursor-pointer rounded border border-border"
          />
          <span className="text-xs text-muted-foreground">{data.color || '#9B8E7B'}</span>
        </div>
      </div>
    </div>
  )
}

export function PropertySheet() {
  const editingNodeId = useCanvasStore((s) => s.editingNodeId)
  const setEditingNodeId = useCanvasStore((s) => s.setEditingNodeId)
  const editingNode = useCanvasStore((s) =>
    s.editingNodeId ? s.nodes.find((n) => n.id === s.editingNodeId) : null
  )

  const isBegin = editingNode?.type === 'beginNode'
  const isComment = editingNode?.type === 'commentNode'
  const isWaitResponse = editingNode?.type === 'waitResponseNode'
  const canShowRuntime = editingNode?.type === 'requestNode' || editingNode?.type === 'waitResponseNode'

  return (
    <Sheet
      open={!!editingNodeId}
      onOpenChange={(open) => {
        if (!open) setEditingNodeId(null)
      }}
    >
      <SheetContent side="right" className="w-[420px] overflow-x-hidden sm:max-w-[420px]" showCloseButton={false}>
        <SheetHeader>
          <SheetTitle className="text-sm">
            {isBegin
              ? 'Begin Properties'
              : isComment
                ? 'Comment Properties'
                : isWaitResponse
                  ? 'Wait Node Properties'
                  : 'Node Properties'}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {isBegin
              ? 'Configure the deviceId used to create or reuse the business session for this chain.'
              : isComment
                ? 'Edit the note title and color.'
                : isWaitResponse
                  ? 'Configure the expected Gc message and inspect the latest runtime payload.'
                  : 'Edit request fields and inspect the latest runtime payload.'}
          </SheetDescription>
        </SheetHeader>
        <div className="grid min-w-0 flex-1 auto-rows-min gap-6 overflow-y-auto overflow-x-hidden px-4">
          {editingNodeId && (
            isBegin
              ? <BeginEditor nodeId={editingNodeId} />
              : isComment
                ? <CommentEditor nodeId={editingNodeId} />
                : isWaitResponse
                  ? <WaitResponseEditor nodeId={editingNodeId} />
                  : <FieldEditor nodeId={editingNodeId} />
          )}
          {canShowRuntime && editingNodeId && (
            <>
              <Separator />
              <RuntimeDataViewer nodeId={editingNodeId} />
            </>
          )}
        </div>
        <SheetFooter>
          <Button
            type="button"
            onClick={() => {
              toast.message('Saved')
              setEditingNodeId(null)
            }}
          >
            Save
          </Button>
          <SheetClose asChild>
            <Button variant="outline">Close</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
