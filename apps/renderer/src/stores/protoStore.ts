import { create } from 'zustand'

export interface FieldInfo {
  name: string
  number: number
  type: string
  kind: string
  isRepeated: boolean
  isOptional: boolean
  isMap: boolean
  mapKey?: string
  mapValue?: string
  oneofName?: string
}

export interface OneofInfo {
  name: string
  fields: string[]
}

export interface EnumInfo {
  name: string
  values: { name: string; number: number }[]
}

export interface MessageInfo {
  Name: string
  ShortName: string
  MessageID?: number
  Fields: FieldInfo[]
  Oneofs: OneofInfo[] | null
  NestedMsgs: MessageInfo[] | null
  NestedEnums: EnumInfo[] | null
}

export interface FileInfo {
  Path: string
  Package: string
  Messages: MessageInfo[] | null
  Enums: EnumInfo[] | null
}

export interface RouteMapping {
  route: number
  stringRoute?: string
  requestMsg: string
  responseMsg: string
}

interface ProtoStore {
  files: FileInfo[]
  messages: MessageInfo[]
  routeMappings: RouteMapping[]

  setFiles: (files: FileInfo[]) => void
  setMessages: (messages: MessageInfo[]) => void
  setRouteMappings: (mappings: RouteMapping[]) => void
  addRouteMapping: (mapping: RouteMapping) => void
  removeRouteMapping: (route: number, stringRoute?: string) => void
  getMessageByName: (name: string) => MessageInfo | undefined
}

export const useProtoStore = create<ProtoStore>((set, get) => ({
  files: [],
  messages: [],
  routeMappings: [],

  setFiles: (files) => set({ files }),
  setMessages: (messages) => set({ messages }),
  setRouteMappings: (mappings) => set({ routeMappings: mappings }),
  addRouteMapping: (mapping) =>
    set((s) => {
      const key = mapping.stringRoute || String(mapping.route)
      return {
        routeMappings: [
          ...s.routeMappings.filter((r) => (r.stringRoute || String(r.route)) !== key),
          mapping,
        ],
      }
    }),
  removeRouteMapping: (route, stringRoute) =>
    set((s) => {
      const key = stringRoute || String(route)
      return {
        routeMappings: s.routeMappings.filter((r) => (r.stringRoute || String(r.route)) !== key),
      }
    }),
  getMessageByName: (name) => get().messages.find((m) => m.Name === name),
}))
