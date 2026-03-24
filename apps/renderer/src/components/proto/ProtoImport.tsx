import { useMemo, useRef } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { uploadProtoFiles } from '@/services/api'
import { useProtoStore } from '@/stores/protoStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSavedConnectionStore } from '@/stores/savedConnectionStore'

export function ProtoImport() {
  const inputRef = useRef<HTMLInputElement>(null)
  const setFiles = useProtoStore((s) => s.setFiles)
  const setMessages = useProtoStore((s) => s.setMessages)
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId)
  const getConnection = useSavedConnectionStore((s) => s.getConnection)

  const codec = useMemo(() => {
    if (!activeConnectionId) return 'protobuf' as const
    return getConnection(activeConnectionId)?.codec ?? 'protobuf'
  }, [activeConnectionId, getConnection])

  const extension = codec === 'thrift' ? '.thrift' : '.proto'
  const schemaLabel = codec === 'thrift' ? 'Thrift' : 'Proto'

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    if (!activeConnectionId) {
      toast.error('No active connection selected')
      return
    }

    const schemaFiles = files.filter((f) => f.name.toLowerCase().endsWith(extension))
    if (schemaFiles.length === 0) {
      toast.error(`${schemaLabel} 文件夹中没有 ${extension} 文件`)
      return
    }

    try {
      const result = await uploadProtoFiles(schemaFiles, activeConnectionId)
      setFiles(result.files || [])
      setMessages(result.messages || [])
      toast.success(`${schemaLabel} import succeeded`, {
        description: `${schemaFiles.length} files, ${(result.messages || []).length} messages`,
      })
    } catch (err) {
      const missing = (err as Error & { missingImports?: string[] }).missingImports
      if (missing && missing.length > 0) {
        toast.error(`${schemaLabel} 文件缺少依赖`, {
          description: `缺少以下文件，请导入包含这些文件的文件夹：\n${missing.join('\n')}`,
          duration: 8000,
        })
      } else {
        toast.error(`${schemaLabel} 导入失败`, {
          description: (err as Error).message,
        })
      }
    }

    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
      />
      <Button
        variant="default"
        size="sm"
        className="w-full gap-1.5 h-7 text-xs"
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="w-3.5 h-3.5" />
        导入{schemaLabel}文件夹
      </Button>
    </>
  )
}
