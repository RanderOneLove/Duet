import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { cpSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

/**
 * `npm run perf` — замер на настоящей библиотеке.
 *
 * Профиль копируется, а не используется на месте: сценарий играет треки,
 * крутит громкость и пишет сессию, и делать это в рабочем профиле было бы
 * свинством. Кэши при копировании пропускаются — с ними профиль весит под
 * гигабайт, а для замера в них нет ничего нужного, кроме, наоборот, вреда:
 * прогретый сетевой кэш показал бы не ту скорость, которую видит человек.
 */

// `require('electron')` вне самого Электрона отдаёт путь к его бинарю. Через
// npx было бы короче, но Node на Windows отказывается запускать .cmd напрямую.
const electronPath = createRequire(import.meta.url)('electron')

const APP_NAME = 'vk-and-ya-music-player'
const source = join(process.env.APPDATA ?? '', APP_NAME)

if (!existsSync(source)) {
  console.error(`Профиль не найден: ${source}`)
  console.error('Запустите приложение и войдите в сервисы, иначе мерить нечего.')
  process.exit(1)
}

if (!existsSync(join(process.cwd(), 'out', 'main', 'index.js'))) {
  console.error('Нет сборки. Сначала `npm run build`.')
  process.exit(1)
}

// Профиль замера живёт между прогонами: иначе не проверить то, ради чего всё
// затевалось, — второй запуск, который должен открываться из сохранённого
// списка. Пересоздать его можно флагом --fresh.
const work = join(tmpdir(), 'duet-perf')
const profile = join(work, 'profile')
const report = join(work, 'report.json')
const fresh = process.argv.includes('--fresh')

mkdirSync(work, { recursive: true })
if (fresh) rmSync(profile, { recursive: true, force: true })

if (!existsSync(profile)) {
  console.log('Копирую профиль без кэшей…')
  cpSync(source, profile, {
    recursive: true,
    filter: (path) => !/(^|[\/])(Cache|Code Cache|GPUCache|Dawn\w*Cache|blob_storage|downloads)([\/]|$)/.test(path)
  })
} else {
  console.log('Профиль замера уже есть — прогон как второй запуск (--fresh, чтобы с нуля).')
}

// Скачанные файлы в копию не переносятся — их там 219 МБ, — но индекс
// загрузок переносится, и без этой правки приложение искало бы файлы в папке
// копии и отвечало бы самому себе отказом. Пусть смотрит в настоящую.
try {
  const file = join(profile, 'settings.json')
  const settings = JSON.parse(readFileSync(file, 'utf8'))
  // --broken-downloads нарочно уводит папку в никуда: тогда скачанные файлы
  // не отдаются, трек загружается и молчит, и видно, выбирается ли плеер из
  // такой тишины сам. Это ровно тот случай, из-за которого он раньше замирал.
  settings.downloadsPath = process.argv.includes('--broken-downloads')
    ? join(work, 'нет-такой-папки')
    : join(source, 'downloads')

  /*
   * Своё приглашение, а не скопированное.
   *
   * Код совместного прослушивания приезжает вместе с профилем, и замер начинал
   * публиковать в ту же сессию, что и настоящее приложение. Два источника в
   * одной сессии перебивают друг друга: у того, кто слушает, трек меняется не
   * тогда, когда переключил ведущий. Замер не должен трогать чужое — тем более
   * то, что человек прямо сейчас слушает.
   */
  settings.togetherCode = randomBytes(12).toString('base64url')
  settings.togetherKey = randomBytes(24).toString('base64url')

  writeFileSync(file, JSON.stringify(settings, null, 2))
} catch (error) {
  console.warn('Не вышло указать папку загрузок:', error.message)
}

const env = { ...process.env, DUET_PERF: report }
// --probe <имя>: вместо замера задать данным один вопрос и напечатать ответ.
const probeAt = process.argv.indexOf('--probe')
if (probeAt >= 0) env.DUET_PROBE = process.argv[probeAt + 1] ?? 'probe'
// Снимки складываются рядом с отчётом, чтобы их можно было просто открыть.
// --relay <адрес>: гонять проверку против настоящего ретранслятора, а не
// поднятого рядом. Нужно после обновления сервера — убедиться, что доехало.
const relayAt = process.argv.indexOf('--relay')
if (relayAt >= 0) env.DUET_RELAY = process.argv[relayAt + 1] ?? ''
env.DUET_SHOTS = join(work, 'shots')
env.DUET_MINI_BOUNDS = join(work, 'mini-bounds.json')
// Электрон, запущенный из npm-скрипта, иначе стартует как обычный Node.
delete env.ELECTRON_RUN_AS_NODE

console.log('Запускаю приложение…')
const child = spawn(electronPath, ['.', `--user-data-dir=${profile}`, '--hidden'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})

let log = ''
child.stdout.on('data', (chunk) => (log += chunk))
child.stderr.on('data', (chunk) => (log += chunk))

const guard = setTimeout(() => {
  console.error('Замер не уложился в пять минут — снимаю.')
  child.kill()
}, 5 * 60 * 1000)

child.on('exit', () => {
  clearTimeout(guard)
  if (!existsSync(report)) {
    console.error('Отчёта нет. Вывод приложения:')
    console.error(log.slice(-4000))
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(report, 'utf8'))
  if (data.probe) {
    console.log(JSON.stringify(data, null, 2))
    return
  }
  print(data)
})

function print(data) {
  if (data.error) console.log(`\nСценарий оборвался: ${data.error}\n`)

  console.log('\n── Запуск ──')
  const marks = data.marks ?? {}
  for (const [name, ms] of Object.entries(marks)) console.log(`  ${pad(name, 18)} ${ms} мс`)

  console.log('\n── Каталог ──')
  for (const row of data.catalogue ?? []) {
    console.log(`  ${pad(row.call, 12)} ${pad(`${row.ms} мс`, 10)} ${pad(`${row.kb} КБ`, 10)} ${row.items} шт.`)
  }

  console.log('\n── От команды до звука ──')
  for (const row of data.playback ?? []) {
    console.log(`  ${pad(row.what, 20)} ${pad(`${row.ms} мс`, 10)} ${row.track}`)
  }

  const renderer = data.renderer ?? {}
  console.log('\n── Окно (за 5 с проигрывания) ──')
  if (renderer.error) console.log(`  ${renderer.error}`)
  else {
    console.log(`  перерисовок      ${renderer.renders} (${renderer.rendersPerSecond} в секунду)`)
    console.log(`  узлов DOM        ${renderer.domNodes}`)
  }

  console.log('')
  console.log('── Главный процесс (по 5 с) ──')
  for (const [label, key] of [
    ['играет', 'mainWhilePlaying'],
    ['пауза', 'mainWhileIdle']
  ]) {
    const row = data[key] ?? {}
    const state = row.playing ? 'звук шёл' : 'тишина'
    console.log(
      `  ${pad(label, 8)} ${pad(`главный ${row.cpuMsPerSecond} мс/с`, 22)}` +
        `${pad(`оболочка ${row.shellCpuPercent}%`, 18)}` +
        `${pad(`звук ${row.audioCpuPercent}%`, 14)}` +
        `${pad(`${row.updatesPerSecond} обновл./с`, 15)} ${state}`
    )
  }
  const screens = data.screens ?? {}
  console.log('── «Вам нравится»: открытие и прокрутка ──')
  if (screens.error) console.log(`  ${screens.error}`)
  else {
    console.log(`  открытие         ${screens.openMs} мс (строк в DOM: ${screens.rows})`)
    console.log(
      `  перенос в окно   liked ${screens.ipcLikedMs} мс (${screens.ipcLikedTracks} треков)` +
        ` · home ${screens.ipcHomeMs} мс`
    )
    console.log(
      `  кадр при скролле медиана ${screens.frameP50} мс · p95 ${screens.frameP95} мс` +
        ` · худший ${screens.frameMax} мс · длиннее 32 мс: ${screens.janky} из ${screens.frames}`
    )
  }
  const discord = data.discord ?? {}
  console.log('── Discord ──')
  console.log(
    `  связь: ${discord.connected ? 'есть' : 'нет'} · отправлено ${discord.sent}` +
      ` · придержано ограничителем ${discord.held}`
  )
  if (discord.connected) {
    console.log(`  перемотка обновила статус: ${discord.seekPushed ? 'да' : 'НЕТ'}`)
    console.log(
      `  после ${discord.skips} пропусков подряд: отправок ${discord.sentDuringSkips},` +
        ` в статусе тот трек, что играет: ${discord.showsCurrentTrack ? 'да' : 'НЕТ'}`
    )
  }
  console.log('')
}

function pad(text, width) {
  return String(text).padEnd(width)
}
