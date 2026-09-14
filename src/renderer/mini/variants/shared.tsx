import { artistLine, type Track } from '@shared/domain'
import { currentTrack, type PlayerCommand, type PlayerState } from '@shared/player'
import { ServiceBadge } from '../../shared/ServiceLogo'
import { Heart, Next, Pause, Play, Prev } from '../../shared/Icons'
import { Cover } from '../../shell/components/Cover'

export interface VariantProps {
  player: PlayerState
  expanded: boolean
  onToggleExpand: () => void
  onCommand: (command: PlayerCommand) => void
  onClose: () => void
  onRestore: () => void
}

export function track(player: PlayerState): Track | null {
  return currentTrack(player)
}

/** Service badge for the playing track, or nothing when idle. */
export function Badge({ player }: { player: PlayerState }): JSX.Element | null {
  const current = currentTrack(player)
  if (!current) return null
  return <ServiceBadge service={current.service} />
}

export function Artwork({ player, className }: { player: PlayerState; className: string }): JSX.Element {
  const track = currentTrack(player)
  return <Cover url={track?.coverUrl} seed={track?.title ?? 'duet'} className={className} />
}

interface TransportProps {
  player: PlayerState
  onCommand: (command: PlayerCommand) => void
  /** Diameter of the central play button; side buttons scale with it. */
  size?: number
  accent?: boolean
  className?: string
}

/** Prev / play-pause / next, shared by every variant. */
export function Transport({ player, onCommand, size = 36, accent = false, className = '' }: TransportProps): JSX.Element {
  const side = Math.round(size * 0.42)
  const has = currentTrack(player) !== null
  return (
    <div className={`transportrow ${className}`}>
      <button className="transport" disabled={!has} title="Предыдущий" onClick={() => onCommand({ type: 'prev' })}>
        <Prev size={side} />
      </button>
      <button
        className={`playbtn ${accent ? 'playbtn--accent' : ''}`}
        style={{ width: size, height: size }}
        disabled={!has}
        title={player.playing ? 'Пауза' : 'Воспроизвести'}
        onClick={() => onCommand({ type: 'playPause' })}
      >
        {player.playing ? <Pause size={Math.round(size * 0.4)} /> : <Play size={Math.round(size * 0.4)} />}
      </button>
      <button className="transport" disabled={!has} title="Следующий" onClick={() => onCommand({ type: 'next' })}>
        <Next size={side} />
      </button>
    </div>
  )
}

export function title(player: PlayerState): string {
  return currentTrack(player)?.title || 'Ничего не играет'
}

export function artist(player: PlayerState): string {
  const current = currentTrack(player)
  return current ? artistLine(current) || '—' : '—'
}

/** Like the playing track, on whichever service it came from. */
export function LikeButton({
  player,
  onCommand,
  size = 13,
  className = ''
}: {
  player: PlayerState
  onCommand: (command: PlayerCommand) => void
  size?: number
  className?: string
}): JSX.Element {
  const current = currentTrack(player)
  return (
    <button
      className={`likebtn ${current?.liked ? 'likebtn--on' : ''} nodrag ${className}`}
      disabled={!current}
      title={current?.liked ? 'Убрать из избранного' : 'В избранное'}
      onClick={() => onCommand({ type: 'toggleLike' })}
    >
      <Heart size={size} />
    </button>
  )
}
