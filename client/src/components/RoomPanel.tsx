'use client';
import { TabBar } from './ui';
export type PanelTab = 'people' | 'chat' | 'queue';
/** Shared sidebar/drawer/panel body. Chat stays mounted so history and unread tracking survive tab switches. */
export default function RoomPanel({ tab, onTab, unread, queueCount, peopleCount, people, chat }: {
  tab: PanelTab; onTab: (t: PanelTab) => void; unread: number; queueCount: number; peopleCount: number; people: React.ReactNode; chat: React.ReactNode }) {
  return <div className="flex h-full min-w-[300px] flex-col bg-surface/60">
    <TabBar<PanelTab> label="Room panel" value={tab} onChange={onTab}
      tabs={[{ id: 'people', label: `People (${peopleCount})` }, { id: 'chat', label: 'Live Chat', badge: tab === 'chat' ? 0 : unread }, { id: 'queue', label: `Queue (${queueCount})` }]} />
    <div className="min-h-0 flex-1">
      <div role="tabpanel" className={tab === 'people' ? 'h-full overflow-y-auto' : 'hidden'}>{people}</div>
      <div role="tabpanel" className={tab === 'people' ? 'hidden' : 'h-full'}>{chat}</div></div></div>;
}
