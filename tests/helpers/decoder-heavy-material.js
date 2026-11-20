/** Held-out synthetic sentences for heavy decoder evaluations. Unlicense. */
const templates = {
  en: [
    'Maya saw __.',
    'We brought __ home.',
    'The farmer found __.',
    'The children drew __.',
    'Did you find __?',
  ],
  ru: [
    'Мы увидели __.',
    'Она рисует __.',
    'Ребёнок нашёл __.',
    'Они обсуждали __.',
    'Ты видел __?',
  ],
  hi: [
    'बच्चे ने __ देखा।',
    'क्या आपने __ देखा?',
    'वह __ घर ले आया।',
    'हमने __ देखा।',
    'मीना ने __ बनाया।',
  ],
  zh: [
    '他看见了__。',
    '小孩画了__。',
    '我记得那个__。',
    '她想买__。',
    '你找到了__吗？',
  ],
};
const objects = {
  en: [
    'a red apple',
    'three flowers',
    'a blue cup',
    'the kitten',
    'a large pumpkin',
    'the missing key',
    'a small kite',
    'a yellow hat',
    'a new bell',
    'the brown basket',
  ],
  ru: [
    'кошку',
    'белку',
    'книгу',
    'сумку',
    'ложку',
    'корзину',
    'картину',
    'машину',
    'тёмную тучу',
    'странную птицу',
  ],
  hi: [
    'एक घर',
    'छोटा कुत्ता',
    'पुराना खिलौना',
    'लाल सेब',
    'नया पौधा',
    'पीला फूल',
    'रंगीन पतंग',
    'सफेद घोड़ा',
    'एक चित्र',
    'मिट्टी का घड़ा',
  ],
  zh: [
    '一只猫',
    '一朵红花',
    '一辆汽车',
    '一顶帽子',
    '一个苹果',
    '一张地图',
    '一把雨伞',
    '一只风筝',
    '一本书',
    '一只小鸟',
  ],
};

export function heldOutDecoderSentences(language) {
  return templates[language].flatMap((pattern) =>
    objects[language].map((name) => pattern.replace('__', name))
  );
}
