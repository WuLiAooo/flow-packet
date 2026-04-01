import { useEffect, useState } from 'react'
import { CollectionBrowser } from '@/components/collection/CollectionBrowser'
import { LocalApiBrowser } from '@/components/collection/LocalApiBrowser'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConnectionStore } from '@/stores/connectionStore'

type PanelTab = 'collection' | 'api'

function canUseApiTab(host: string) {
  return host === '127.0.0.1' || host.startsWith('192.168.')
}

export function CollectionPanel() {
  const host = useConnectionStore((s) => s.config.host)
  const showApiTab = canUseApiTab(host)
  const [activeTab, setActiveTab] = useState<PanelTab>('collection')

  useEffect(() => {
    if (!showApiTab && activeTab !== 'collection') {
      setActiveTab('collection')
    }
  }, [activeTab, showApiTab])

  if (!showApiTab) {
    return <CollectionBrowser />
  }

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PanelTab)} className="flex h-full flex-col gap-0">
      <div className="border-b border-border px-2 pt-2">
        <TabsList variant="line" className="h-auto w-full justify-start gap-2 p-0">
          <TabsTrigger value="collection" className="h-8 flex-none px-3 text-xs">
            集合
          </TabsTrigger>
          <TabsTrigger value="api" className="h-8 flex-none px-3 text-xs">
            API
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="collection" className="min-h-0 flex-1">
        <CollectionBrowser />
      </TabsContent>
      <TabsContent value="api" className="min-h-0 flex-1">
        <LocalApiBrowser />
      </TabsContent>
    </Tabs>
  )
}