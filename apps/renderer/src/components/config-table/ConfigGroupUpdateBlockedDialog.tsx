import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface ConfigGroupUpdateBlockedDialogProps {
  open: boolean
  files: string[]
  onClose: () => void
}

export function ConfigGroupUpdateBlockedDialog({
  open,
  files,
  onClose,
}: ConfigGroupUpdateBlockedDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{'\u68c0\u6d4b\u5230 XLSX \u6587\u4ef6\u88ab\u5360\u7528'}</AlertDialogTitle>
          <AlertDialogDescription>
            {'\u8bf7\u5148\u5173\u95ed Excel/WPS \u4e2d\u6253\u5f00\u7684 XLSX \u6587\u4ef6\uff0c\u7136\u540e\u518d\u6267\u884c\u66f4\u65b0\u3002'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-64 overflow-auto rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-foreground">
          {files.map((file) => (
            <div key={file} className="break-all py-1">{file}</div>
          ))}
        </div>
        <AlertDialogFooter>
          <Button onClick={onClose}>{'\u6211\u77e5\u9053\u4e86'}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}