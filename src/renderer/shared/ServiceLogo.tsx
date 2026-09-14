import type { ServiceId } from '@shared/domain'
import { SERVICE_META } from '@shared/domain'
import vkLogo from '../assets/vk.png'
import yandexLogo from '../assets/yandex.png'

/**
 * The service marks. Both the shell and the mini player use them, so they live
 * here rather than next to either one's components.
 */

const LOGOS: Record<ServiceId, string> = { vk: vkLogo, yandex: yandexLogo }

/**
 * The mark on its own, for places with room for it — account and connect cards.
 * VK's mark is wide and Yandex's is square, so they are given the same square
 * box and contained inside it; sizing by height alone made VK loom over Yandex.
 */
export function ServiceLogo({ service, size = 20 }: { service: ServiceId; size?: number }): JSX.Element {
  return (
    <img
      className="servicelogo"
      src={LOGOS[service]}
      alt={SERVICE_META[service].label}
      title={SERVICE_META[service].label}
      style={{ width: size, height: size }}
      draggable={false}
    />
  )
}

/**
 * The same mark where a text badge used to sit, in track rows and lists. The
 * two logos have different proportions, so the box is fixed and the image is
 * contained inside it — otherwise a column of badges would not line up.
 */
export function ServiceBadge({
  service,
  className = ''
}: {
  service: ServiceId
  className?: string
}): JSX.Element {
  return (
    <img
      className={`servicebadge ${className}`}
      src={LOGOS[service]}
      alt={SERVICE_META[service].label}
      title={SERVICE_META[service].label}
      draggable={false}
    />
  )
}
