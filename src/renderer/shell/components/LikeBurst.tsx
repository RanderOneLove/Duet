import { useEffect, useRef, useState } from 'react'
import { Heart } from '../../shared/Icons'

/**
 * Сердечки, разлетающиеся от кнопки «нравится».
 *
 * Это единственное движение в приложении, у которого нет другой работы, кроме
 * радости, — поэтому оно и выключается отдельной настройкой. Всё остальное
 * здесь служит понятности: подсказывает, откуда что взялось и куда делось.
 *
 * Цвет берётся из акцента, а тот, если включено, снят с обложки, — так что
 * искры оказываются в цвете того, что сейчас играет.
 */

interface Spark {
  id: number
  /** Куда полетит, в пикселях от кнопки. */
  x: number
  y: number
  turn: number
  scale: number
  delay: number
}

const HOW_MANY = 7
const FLIGHT_MS = 900

export function LikeBurst({ fire }: { fire: number }): JSX.Element | null {
  const [sparks, setSparks] = useState<Spark[]>([])
  const seq = useRef(0)

  useEffect(() => {
    if (fire <= 0) return

    /*
     * Разброс случайный, но не равномерный: сердечки летят вверх веером, как
     * если бы их подбросили, а не рассыпали. Ровное кольцо читается как
     * механика, а не как радость.
     */
    const born: Spark[] = Array.from({ length: HOW_MANY }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6
      const reach = 26 + Math.random() * 34
      seq.current += 1
      return {
        id: seq.current,
        x: Math.cos(angle) * reach,
        y: Math.sin(angle) * reach,
        turn: (Math.random() - 0.5) * 70,
        scale: 0.7 + Math.random() * 0.7,
        delay: Math.random() * 90
      }
    })

    setSparks((prev) => [...prev, ...born])
    const timer = window.setTimeout(() => {
      const ids = new Set(born.map((spark) => spark.id))
      setSparks((prev) => prev.filter((spark) => !ids.has(spark.id)))
    }, FLIGHT_MS + 150)

    return () => window.clearTimeout(timer)
  }, [fire])

  if (sparks.length === 0) return null

  return (
    <span className="likeburst" aria-hidden={true}>
      {sparks.map((spark) => (
        <span
          key={spark.id}
          className="likeburst__spark"
          style={{
            // Значения идут переменными, чтобы кадры описывались в стилях, а
            // не собирались строкой на каждое сердечко.
            '--x': `${Math.round(spark.x)}px`,
            '--y': `${Math.round(spark.y)}px`,
            '--turn': `${Math.round(spark.turn)}deg`,
            '--scale': spark.scale.toFixed(2),
            animationDelay: `${Math.round(spark.delay)}ms`
          } as React.CSSProperties}
        >
          <Heart size={12} />
        </span>
      ))}
    </span>
  )
}
