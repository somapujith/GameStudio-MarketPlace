// Phones: the control panel's Manage / Trade tabs as one bottom sheet (the panel itself only keeps the Play pane).
// <ManageSheet session open tab onTab onClose onOpenTile onOpenTrade />
import Sheet from '../ui/Sheet.jsx';
import { Segmented } from '../ui/Controls.jsx';
import MyProperties from '../MyProperties.jsx';
import { TradePane } from '../ControlPanel.jsx';
import '@/styles/turn.css';

const TABS = [
  { value: 'manage', label: 'My districts' },
  { value: 'trade', label: 'Trade' },
];

export default function ManageSheet({ session, open, tab = 'manage', onTab, onClose, onOpenTile, onOpenTrade }) {
  return (
    <Sheet open={open} onClose={onClose} title={tab === 'trade' ? 'Trade' : 'Manage'} className="ms-sheet">
      <Segmented label="Show" value={tab} options={TABS} onChange={onTab} />
      <div className="ms-paper cp-paperscope">
        {tab === 'trade' ? (
          <TradePane session={session} onOpenTrade={onOpenTrade} />
        ) : (
          <MyProperties
            session={session}
            onOpenTile={(id) => {
              onClose?.();
              onOpenTile?.(id);
            }}
          />
        )}
      </div>
    </Sheet>
  );
}
