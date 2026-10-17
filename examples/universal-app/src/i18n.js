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
    },
    acoustics: {
      title: 'Microphone and room',
      microphone: 'Microphone',
      micDistance: 'Distance from the lips',
      micAzimuth: 'Azimuth (90° = left, 180° = behind)',
      micElevation: 'Elevation',
      micCompensate: 'Keep the loudness of a close microphone',
      room: 'Room',
      roomPreset: 'Reverberation',
      roomNote:
        'The room echo is added after the simulation. A distant microphone hears more of it.',
      rooms: {
        anechoic: 'Anechoic (no echo)',
        studio: 'Studio',
        'small-room': 'Small room',
        office: 'Office',
        bathroom: 'Bathroom',
        classroom: 'Classroom',
        hall: 'Hall',
        cathedral: 'Cathedral',
      },
      box: 'Box around the head',
      boxEnabled: 'Simulate a box of air with walls',
      boxWidth: 'Width',
      boxHeight: 'Height',
      boxDepth: 'Depth',
      boxAbsorption: 'Wall absorption',
      boxNote:
        'The high and ultra tiers simulate the walls in 3D; the others approximate them.',
      boxTooLarge: 'The box has too many voxels for these tiers',
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
    },
    acoustics: {
      title: 'Микрофон и помещение',
      microphone: 'Микрофон',
      micDistance: 'Расстояние от губ',
      micAzimuth: 'Азимут (90° — слева, 180° — сзади)',
      micElevation: 'Высота',
      micCompensate: 'Сохранять громкость близкого микрофона',
      room: 'Помещение',
      roomPreset: 'Реверберация',
      roomNote:
        'Эхо помещения добавляется после моделирования. Дальний микрофон слышит его сильнее.',
      rooms: {
        anechoic: 'Безэховая камера',
        studio: 'Студия',
        'small-room': 'Маленькая комната',
        office: 'Офис',
        bathroom: 'Ванная',
        classroom: 'Класс',
        hall: 'Зал',
        cathedral: 'Собор',
      },
      box: 'Коробка вокруг головы',
      boxEnabled: 'Моделировать коробку воздуха со стенками',
      boxWidth: 'Ширина',
      boxHeight: 'Высота',
      boxDepth: 'Глубина',
      boxAbsorption: 'Поглощение стенок',
      boxNote:
        'Уровни high и ultra моделируют стенки в 3D, остальные — приближённо.',
      boxTooLarge: 'В коробке слишком много вокселей для этих уровней',
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
  vibrato: 'Вибрато',
  speechRate: 'Темп речи',
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
