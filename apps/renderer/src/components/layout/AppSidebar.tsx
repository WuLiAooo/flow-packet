import { Blocks, Library, LayoutDashboard } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export type SidebarTab = 'canvas' | 'collection' | 'api'

const navItems: { icon: typeof LayoutDashboard; value: SidebarTab; label: string }[] = [
  { icon: LayoutDashboard, value: 'canvas', label: '\u753b\u5e03' },
  { icon: Library, value: 'collection', label: '\u96c6\u5408' },
  { icon: Blocks, value: 'api', label: 'API' },
]

export const SIDEBAR_TABS = {
  canvas: 'canvas' as SidebarTab,
  collection: 'collection' as SidebarTab,
  api: 'api' as SidebarTab,
} as const

export function AppSidebar({
  activeTab,
  onTabChange,
}: {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2" style={{ background: 'var(--bg-activity)' }}>
        {navItems.map((item) => (
          <Tooltip key={item.value}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onTabChange(item.value)}
                className={`flex size-9 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground${
                  activeTab === item.value ? ' bg-sidebar-accent text-sidebar-accent-foreground' : ''
                }`}
              >
                <item.icon className="size-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>
    </TooltipProvider>
  )
}