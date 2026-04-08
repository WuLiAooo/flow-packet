import { CodeXml, Library, LayoutDashboard, TableProperties } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export type SidebarTab = 'canvas' | 'collection' | 'api' | 'config'

type NavItem = {
  icon: typeof LayoutDashboard
  value: SidebarTab
  label: string
}

const navItems: NavItem[] = [
  { icon: LayoutDashboard, value: 'canvas', label: '画布' },
  { icon: Library, value: 'collection', label: '集合' },
  { icon: CodeXml, value: 'api', label: 'API' },
  { icon: TableProperties, value: 'config', label: '配置表' },
]

export const SIDEBAR_TABS = {
  canvas: 'canvas' as SidebarTab,
  collection: 'collection' as SidebarTab,
  api: 'api' as SidebarTab,
  config: 'config' as SidebarTab,
} as const

export function AppSidebar({
  activeTab,
  onTabChange,
  showApiTab = true,
  showConfigTab = true,
}: {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  showApiTab?: boolean
  showConfigTab?: boolean
}) {
  const visibleItems = navItems.filter((item) => {
    if (item.value === SIDEBAR_TABS.api && !showApiTab) {
      return false
    }
    if (item.value === SIDEBAR_TABS.config && !showConfigTab) {
      return false
    }
    return true
  })

  return (
    <TooltipProvider delayDuration={0}>
      <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border py-2" style={{ background: 'var(--bg-activity)' }}>
        {visibleItems.map((item) => (
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
