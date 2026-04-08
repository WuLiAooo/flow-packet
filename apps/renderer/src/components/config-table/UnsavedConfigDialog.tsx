import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface UnsavedConfigDialogProps {
  open: boolean
  onSaveAndSwitch: () => void
  onDiscardAndSwitch: () => void
  onCancel: () => void
}

export function UnsavedConfigDialog({
  open,
  onSaveAndSwitch,
  onDiscardAndSwitch,
  onCancel,
}: UnsavedConfigDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>有未保存修改</AlertDialogTitle>
          <AlertDialogDescription>
            切换前请先选择保存、放弃，或取消当前操作。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button variant="secondary" onClick={onDiscardAndSwitch}>不保存并切换</Button>
          <Button onClick={onSaveAndSwitch}>保存并切换</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
