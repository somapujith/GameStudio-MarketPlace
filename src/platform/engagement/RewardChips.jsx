import { CoinIcon } from '@/components/shell/icons.jsx';
import { Preview } from '@/platform/home/Ava.jsx';
import { rewardChips } from './engagementModel.js';

/**
 * Reward chips for an achievement or a prize tier: coins and / or the cosmetic drawn with the shop's own preview art.
 * `reward` = { coins?, itemId?, itemName? }. `avatar` lets a frame show the player's own face.
 */
export default function RewardChips({ reward, avatar, size = 26, label = 'Reward', className = '' }) {
  const chips = rewardChips(reward);
  if (!chips.length) return null;
  return (
    <ul className={`cj-pro-rewards ${className}`.trim()} aria-label={label}>
      {chips.map((c) => (
        <li key={c.kind} className={`cj-pro-reward cj-pro-reward--${c.kind}`} data-rarity={c.item?.rarity}>
          {c.kind === 'coins' ? (
            <CoinIcon size={15} />
          ) : c.item ? (
            <span className="cj-pro-reward__art" aria-hidden="true">
              <Preview item={c.item} size={size} avatar={avatar} />
            </span>
          ) : null}
          {/* a title's art already spells its name */}
          {!(c.item && c.item.kind === 'title') && <span aria-hidden="true">{c.label}</span>}
          <span className="sr-only">{c.spoken}</span>
        </li>
      ))}
    </ul>
  );
}
