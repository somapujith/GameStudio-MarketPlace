import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CodeInput from '@/components/online/CodeInput.jsx';
import { ROOM_CODE_LENGTH, isRoomCode } from '@/components/online/codes.js';
import Modal from '@/components/shell/Modal.jsx';
import HubIcon from '@/platform/game/HubIcon.jsx';
import { paths } from '@/platform/paths.js';
import '@/styles/join-code.css';

/**
 * "Have a code?" sheet: a six-character room code -> /join/:code. Opens with the code field focused and a Paste
 * button ready; the sixth character (typed or pasted) takes you straight to the table, so the button is only a
 * fallback. Bottom sheet on phones (the shared Modal lifts it above the keyboard with --kb-inset), centred card on
 * desktop (focus trap, Esc, scroll lock and focus restore come from Modal).
 */
export default function CodeSheet({ open, onClose }) {
  const navigate = useNavigate();
  const uid = useId();
  const [value, setValue] = useState('');
  const [tried, setTried] = useState(false);
  const sent = useRef(false); // one trip per opening, however the code arrives (6th key, paste, Enter, button)

  useEffect(() => {
    if (open) {
      setValue('');
      setTried(false);
      sent.current = false;
    }
  }, [open]);

  const ok = isRoomCode(value);
  const showError = tried && !ok;

  const go = (code) => {
    if (sent.current) return;
    sent.current = true;
    onClose?.();
    navigate(paths.join(code));
  };
  const submit = (e) => {
    e.preventDefault();
    if (!ok) {
      setTried(true);
      return;
    }
    go(value);
  };

  return (
    <Modal open={open} onClose={onClose} title="Join with a code" className="hub-sheet">
      <form className="jc-sheet" onSubmit={submit} noValidate>
        <p className="jc-sheet__hint" id={`${uid}-hint`}>
          {`Ask the host for the ${ROOM_CODE_LENGTH}-character room code, or paste their invite link.`}
        </p>
        <CodeInput
          value={value}
          onChange={(v) => {
            setValue(v);
            setTried(false);
          }}
          onComplete={go}
          state={showError ? 'error' : ok ? 'ok' : 'idle'}
          message={showError ? `Enter all ${ROOM_CODE_LENGTH} characters of the code.` : ok ? 'Taking you to the table...' : ''}
          describedBy={`${uid}-hint`}
          label="Room code"
          autoFocus
        />
        <button type="submit" className="hub-btn hub-btn--primary hub-btn--lg hub-btn--block">
          Find table <HubIcon name="arrowR" size={18} />
        </button>
      </form>
    </Modal>
  );
}
