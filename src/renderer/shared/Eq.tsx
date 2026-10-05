/**
 * Четыре столбика «играет сейчас».
 *
 * Знак, а не украшение: он отвечает на вопрос «звучит ли это прямо сейчас»
 * без единого слова, поэтому и замирает на паузе — замерший эквалайзер и есть
 * пауза. Петля у него быстрая, вопреки общему правилу про медленное движение,
 * потому что это показание прибора, а не фон; при выключенном движении он
 * стоит неподвижно (см. motion.css).
 *
 * Цвет — текущий, от родителя: на чёрной шторке это акцент, на hero — белый.
 */
export function Eq({
  playing,
  height = 14,
  bar = 3,
  className = ''
}: {
  playing: boolean
  height?: number
  bar?: number
  className?: string
}): JSX.Element {
  return (
    <span
      className={`eq ${playing ? 'eq--on' : ''} ${className}`}
      style={{ height, gap: Math.max(2, Math.round(bar * 0.7)) }}
      aria-hidden={true}
    >
      {[0, 1, 2, 3].map((index) => (
        <i key={index} style={{ width: bar }} />
      ))}
    </span>
  )
}
