/** UI strings (English and Russian; the simulator itself speaks four languages). */

const STRINGS = {
  en: {
    eyebrow: 'Physical 3D voice simulation',
    title: 'Voice Simulator',
    lead: 'No recordings: every sound is a pressure wave travelling through the 3D shape of this head.',
    text: 'Text to speak',
    language: 'Language',
    auto: 'Auto-detect',
    ipa: 'IPA',
    speak: 'Speak',
    stop: 'Stop',
    mode: 'Mode',
    both: 'Sound + 3D',
    sound: 'Sound only',
    visual: '3D only',
    animateMouth: 'Animate jaw and lips',
    showField: 'Show pressure field',
    quality: 'Audio quality',
    autoQuality: 'Auto (keep 20% headroom)',
    downloadWav: 'Download WAV',
    exportObj: 'Export OBJ',
    head: 'Head and voice',
    seed: 'Seed',
    randomize: 'Randomize',
    preset: 'Voice type',
    presets: { any: 'any', male: 'male', female: 'female', child: 'child' },
    reset: 'Defaults',
    audio: 'Audio',
    visuals: 'Visuals',
    load: 'load',
    target: 'target 80%',
    solver: 'solver',
    underruns: 'underruns',
    overloads: 'early step-downs',
    benchmarking: 'Measuring this device…',
    noWebgl:
      'WebGL is not available, so the 3D view is off. Sound still works.',
    viewerHint:
      'Drag to orbit, scroll to zoom. Tube colour = acoustic pressure.',
    theme: 'Theme',
    themes: { system: 'system', light: 'light', dark: 'dark' },
    groups: {
      anatomy: 'Vocal tract',
      mouth: 'Mouth and jaw',
      face: 'Face',
      voice: 'Voice',
      source: 'Voice source',
      prosody: 'Prosody and timing',
      acoustics: 'Acoustics',
    },
  },
  ru: {
    eyebrow: 'Физическое 3D-моделирование голоса',
    title: 'Симулятор голоса',
    lead: 'Никаких записей: каждый звук — это волна давления, идущая через 3D-форму этой головы.',
    text: 'Текст',
    language: 'Язык',
    auto: 'Автоопределение',
    ipa: 'МФА',
    speak: 'Произнести',
    stop: 'Стоп',
    mode: 'Режим',
    both: 'Звук + 3D',
    sound: 'Только звук',
    visual: 'Только 3D',
    animateMouth: 'Анимировать челюсть и губы',
    showField: 'Показывать поле давления',
    quality: 'Качество звука',
    autoQuality: 'Авто (запас 20%)',
    downloadWav: 'Скачать WAV',
    exportObj: 'Экспорт OBJ',
    head: 'Голова и голос',
    seed: 'Зерно',
    randomize: 'Случайно',
    preset: 'Тип голоса',
    presets: {
      any: 'любой',
      male: 'мужской',
      female: 'женский',
      child: 'детский',
    },
    reset: 'По умолчанию',
    audio: 'Звук',
    visuals: 'Графика',
    load: 'нагрузка',
    target: 'цель 80%',
    solver: 'решатель',
    underruns: 'опустошения буфера',
    overloads: 'ранние понижения',
    benchmarking: 'Измеряем производительность…',
    noWebgl: 'WebGL недоступен, 3D-вид отключён. Звук работает.',
    viewerHint:
      'Тяните для вращения, колесо — масштаб. Цвет трубки — акустическое давление.',
    theme: 'Тема',
    themes: { system: 'системная', light: 'светлая', dark: 'тёмная' },
    groups: {
      anatomy: 'Речевой тракт',
      mouth: 'Рот и челюсть',
      face: 'Лицо',
      voice: 'Голос',
      source: 'Голосовой источник',
      prosody: 'Просодия и темп',
      acoustics: 'Акустика',
    },
  },
};

const PARAMETER_LABELS_RU = {
  vocalTractLength: 'Длина тракта',
  pharynxRatio: 'Доля глотки',
  pharynxWidth: 'Ширина глотки',
  oralWidth: 'Ширина ротовой полости',
  nasalSize: 'Размер носовой полости',
  mouthWidth: 'Ширина рта',
  lipThickness: 'Толщина губ',
  jawRange: 'Ход челюсти',
  tongueSize: 'Размер языка',
  headWidth: 'Ширина головы',
  headHeight: 'Высота головы',
  noseLength: 'Длина носа',
  pitch: 'Высота тона',
  pitchRange: 'Диапазон тона',
  tenseness: 'Напряжённость',
  breathiness: 'Придыхание',
  vibrato: 'Глубина вибрато',
  speechRate: 'Темп речи',
  jitter: 'Джиттер',
  shimmer: 'Шиммер',
  vibratoRate: 'Частота вибрато',
  aspirationLevel: 'Шум придыхания',
  declination: 'Деклинация',
  accentStrength: 'Сила ударения',
  stressLengthening: 'Удлинение ударных',
  finalLengthening: 'Удлинение в конце фразы',
  pauseLength: 'Длина пауз',
  articulationSpeed: 'Скорость артикуляции',
  wallLoss: 'Потери в стенках',
  nasalCoupling: 'Носовая связь',
  fricationLevel: 'Уровень шума фрикативных',
  outputGain: 'Громкость выхода',
};

/** Pick the UI locale from the browser languages. */
export function detectLocale(
  languages = globalThis.navigator?.languages ?? []
) {
  return languages.some((language) => language.toLowerCase().startsWith('ru'))
    ? 'ru'
    : 'en';
}

export function strings(locale) {
  return STRINGS[locale] ?? STRINGS.en;
}

export function parameterLabel(parameter, locale) {
  return (
    (locale === 'ru' && PARAMETER_LABELS_RU[parameter.key]) || parameter.label
  );
}
