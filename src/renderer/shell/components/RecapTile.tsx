import type { RecapOffer } from '@shared/recap'
import { Fan } from './RecapParts'

/**
 * Вход в итоги на Главной — та же плита, что у волны: размытая обложка
 * главного трека под тёмной вуалью. После просмотра или «Скрыть» уходит;
 * значок в колонке остаётся, но без точки.
 */
export function RecapTile({
  offer,
  onOpen,
  onHide
}: {
  offer: RecapOffer
  onOpen: () => void
  onHide: () => void
}): JSX.Element {
  const glow = offer.covers.find(Boolean)
  return (
    <section className="recaptile">
      {glow && <div className="recaptile__glow" style={{ backgroundImage: `url("${glow}")` }} />}
      <div className="recaptile__body">
        <Fan covers={offer.covers} seed={offer.key} size="92px" radius="13px" className="recaptile__fan" />
        <div className="recaptile__text">
          <div className="recaptile__kicker">{offer.kicker}</div>
          <div className="recaptile__title">{offer.title}</div>
          <div className="recaptile__sub">{offer.sub}</div>
        </div>
        <div className="recaptile__actions">
          <button className="rs-btn rs-btn--primary" onClick={onOpen}>
            Смотреть итоги
          </button>
          <button className="rs-btn rs-btn--ghost" onClick={onHide}>
            Скрыть
          </button>
        </div>
      </div>
    </section>
  )
}
