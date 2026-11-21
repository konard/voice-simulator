/**
 * Blind listening test page (issue 20): MUSHRA, ABX and intelligibility;
 * choice trials (issue 55) ask which emotion a sentence was spoken in.
 *
 * This is a classic script, not an ES module. A browser refuses to load
 * modules and to fetch files from a page opened from disk (file://), so
 * index.html loads config.js and this file with plain <script src> tags and
 * every sound is played by an <audio> element. Nothing is sent over the
 * network and nothing personal is stored: the result is a file that the
 * listener downloads and sends by hand.
 *
 * The pure functions are on globalThis.ListeningTest, so the tests can load
 * this file with `await import(...)`. Only ListeningTest.start(), which
 * index.html calls, touches the document.
 *
 * Unlicense (public domain).
 */

((root) => {
  'use strict';

  const TYPES = ['mushra', 'abx', 'intelligibility', 'choice'];
  const MAX_CONDITIONS = 12;
  const RESULT_SCHEMA = 1;

  /** MUSHRA scale of ITU-R BS.1534-3: five equal intervals of 20 points. */
  const SCALE = [
    { label: 'Bad', from: 0, to: 20 },
    { label: 'Poor', from: 20, to: 40 },
    { label: 'Fair', from: 40, to: 60 },
    { label: 'Good', from: 60, to: 80 },
    { label: 'Excellent', from: 80, to: 100 },
  ];
  const SPEAKER_SCALE = ['0 · Different speaker', '100 · Same speaker'];

  const TEXT = {
    consent:
      'Your answers are saved in a file on this computer only. It holds ' +
      'your ratings, the time you spent on each trial, whether you use ' +
      'headphones and, if you give it, your native language; it holds no ' +
      'name, address or browser details. By pressing "Start" you agree ' +
      'that this file may be published as part of the results of the test.',
    mushra:
      'Listen to the reference and to every version, as often as you like. ' +
      'Rate how close each version sounds to the reference. ' +
      'One of the versions is the reference itself. Rate it 100.',
    speaker:
      'Compare the speaker in each clip with the reference speaker. ' +
      'Rate speaker identity from 0 to 100, regardless of the words or audio quality.',
    abx:
      'A and B are two different versions. X is one of them. ' +
      'Listen and choose which one X is.',
    intelligibility:
      'Listen to the sentence and type the words you heard. ' +
      'The sentence may not make sense; type what you heard anyway.',
    choice:
      'Listen to the sentence and choose the emotion of the voice. The ' +
      'words do not tell it, and you do not need to understand them.',
    end: 'Send this file to the person who asked you to take the test.',
    // Never name the file: its name tells which version is playing.
    notLoaded:
      'A sound could not be loaded or played. Check that headphones or ' +
      'speakers are connected and that the folder "stimuli" is next to ' +
      'index.html, or ask the person who sent you the test.',
    notPlayed:
      'A sound could not be played. Press its button again; if it still ' +
      'stays silent, try another browser.',
  };

  const isObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const isText = (value) => typeof value === 'string' && value.trim() !== '';

  // -------------------------------------------------------------------------
  // Random numbers

  /**
   * Seeded generator returning floats in [0, 1): mulberry32, the same
   * generator as createRandom() of src/random.js (for a numeric seed it
   * gives the same numbers). It is copied here because a classic script
   * cannot import src/random.js.
   * @param {number} seed 32-bit unsigned integer
   * @returns {() => number}
   */
  function createRandom(seed) {
    let state = seed >>> 0 || 0x9e3779b9;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** @returns {Uint32Array} `count` values from crypto.getRandomValues */
  function cryptoValues(count) {
    const values = new Uint32Array(count);
    root.crypto.getRandomValues(values);
    return values;
  }

  /** A fresh session seed: one 32-bit value from crypto.getRandomValues. */
  function randomSeed() {
    return cryptoValues(1)[0];
  }

  /** An anonymous listener code: 8 random hexadecimal characters. */
  function randomListener() {
    return cryptoValues(1)[0].toString(16).padStart(8, '0');
  }

  /**
   * Fisher-Yates shuffle of a copy of `items`.
   * @template T
   * @param {T[]} items
   * @param {() => number} random
   * @returns {T[]}
   */
  function shuffle(items, random) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Configuration

  function mushraErrors(trial, name) {
    const errors = [];
    const conditions = isObject(trial.conditions) ? trial.conditions : {};
    if (!isText(conditions.reference)) {
      errors.push(`${name}: MUSHRA trial without a condition "reference"`);
    }
    const count = Object.keys(conditions).length;
    if (count > MAX_CONDITIONS) {
      errors.push(
        `${name}: MUSHRA trial with ${count} conditions, more than ${MAX_CONDITIONS}`
      );
    }
    if (trial.rating !== undefined && trial.rating !== 'speaker') {
      errors.push(`${name}: unsupported MUSHRA rating "${trial.rating}"`);
    }
    return errors;
  }

  /** Errors of the keys that a trial type needs and of its maxPlays. */
  function playedErrors(trial, name, keys, label = trial.type) {
    const errors = keys
      .filter((key) => !isText(trial[key]))
      .map((key) => `${name}: ${label} trial without "${key}"`);
    const { maxPlays } = trial;
    if (
      maxPlays !== undefined &&
      !(Number.isInteger(maxPlays) && maxPlays > 0)
    ) {
      errors.push(`${name}: maxPlays must be a positive integer`);
    }
    return errors;
  }

  function choiceErrors(trial, name) {
    const errors = playedErrors(trial, name, ['audio', 'answer']);
    const { choices } = trial;
    const valid =
      Array.isArray(choices) &&
      choices.length >= 2 &&
      choices.every(isText) &&
      new Set(choices).size === choices.length;
    if (!valid) {
      errors.push(`${name}: choices must be two or more different names`);
    } else if (!choices.includes(trial.answer)) {
      errors.push(`${name}: the answer is not among the choices`);
    }
    return errors;
  }

  function trialErrors(trial, name) {
    switch (trial.type) {
      case 'mushra':
        return mushraErrors(trial, name);
      case 'abx':
        return ['a', 'b']
          .filter((key) => !isText(trial[key]))
          .map((key) => `${name}: ABX trial without "${key}"`);
      case 'intelligibility':
        return playedErrors(trial, name, ['audio', 'text']);
      case 'choice':
        return choiceErrors(trial, name);
      default:
        return [`${name}: unknown type "${trial.type}"`];
    }
  }

  /**
   * Check a configuration (globalThis.LISTENING_TEST_CONFIG).
   * @param {unknown} config
   * @returns {string[]} errors; empty when the configuration can be used
   */
  function validateConfig(config) {
    if (!isObject(config)) {
      return ['the configuration is not an object'];
    }
    const errors = [];
    if (!isText(config.id)) {
      errors.push('missing id of the test');
    }
    if (!Array.isArray(config.trials) || config.trials.length === 0) {
      errors.push('no trials');
      return errors;
    }
    const seen = new Set();
    config.trials.forEach((trial, index) => {
      const name = `trial ${index + 1}${isText(trial?.id) ? ` (${trial.id})` : ''}`;
      if (!isObject(trial)) {
        errors.push(`${name}: not an object`);
        return;
      }
      if (!isText(trial.id)) {
        errors.push(`${name}: missing id`);
      } else if (seen.has(trial.id)) {
        errors.push(`${name}: duplicate trial id "${trial.id}"`);
      }
      seen.add(trial.id);
      errors.push(...trialErrors(trial, name));
    });
    return errors;
  }

  // -------------------------------------------------------------------------
  // Session plan

  function planTrial(trial, random) {
    if (trial.type === 'mushra') {
      const names = shuffle(Object.keys(trial.conditions), random);
      return {
        type: 'mushra',
        id: trial.id,
        text: trial.text ?? null,
        ...(trial.rating && { rating: trial.rating }),
        reference: trial.reference ?? trial.conditions.reference,
        conditions: names.map((name, index) => ({
          label: String.fromCharCode(65 + index),
          name,
          file: trial.conditions[name],
        })),
      };
    }
    if (trial.type === 'abx') {
      return {
        type: 'abx',
        id: trial.id,
        a: trial.a,
        b: trial.b,
        x: random() < 0.5 ? 'a' : 'b',
      };
    }
    if (trial.type === 'choice') {
      return {
        type: 'choice',
        id: trial.id,
        audio: trial.audio,
        choices: shuffle(trial.choices, random),
        answer: trial.answer,
        maxPlays: trial.maxPlays ?? 2,
      };
    }
    return {
      type: 'intelligibility',
      id: trial.id,
      audio: trial.audio,
      text: trial.text,
      maxPlays: trial.maxPlays ?? 1,
    };
  }

  /**
   * Put the trials in a random order (Fisher-Yates), shuffle the conditions
   * of each MUSHRA trial (shown as A, B, ...), draw X of each ABX trial and
   * shuffle the answers of each choice trial.
   * @param {{trials: object[]}} config a valid configuration
   * @param {number} [seed] 32-bit seed; drawn once with
   *   crypto.getRandomValues when absent
   * @returns {{seed: number, trials: object[]}}
   */
  function planSession(config, seed) {
    const used = seed === undefined ? randomSeed() : seed >>> 0;
    const random = createRandom(used);
    const order = shuffle(config.trials, random);
    return {
      seed: used,
      trials: order.map((trial) => planTrial(trial, random)),
    };
  }

  // -------------------------------------------------------------------------
  // Results

  /** The only keys a trial record keeps, by type. */
  const RECORD_KEYS = {
    mushra: ['id', 'type', 'order', 'ratings', 'plays', 'seconds'],
    abx: ['id', 'type', 'x', 'answer', 'correct', 'plays', 'seconds'],
    intelligibility: ['id', 'type', 'typed', 'plays', 'seconds'],
    choice: ['id', 'type', 'chosen', 'correct', 'plays', 'seconds'],
  };

  function cleanRecord(record) {
    const keys = RECORD_KEYS[record.type];
    if (!keys) {
      throw new Error(`unknown trial type "${record.type}"`);
    }
    return Object.fromEntries(keys.map((key) => [key, record[key] ?? null]));
  }

  /** @param {Date|string} [date] @returns {string} YYYY-MM-DD (UTC) */
  function formatDate(date = new Date()) {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    return new Date(date).toISOString().slice(0, 10);
  }

  /** Two lower-case letters (ISO 639-1) or null. */
  function normalizeLanguage(value) {
    const text = String(value ?? '')
      .trim()
      .toLowerCase();
    return /^[a-z]{2}$/.test(text) ? text : null;
  }

  /**
   * The result file of one listener. Nothing else is stored: no name, no
   * address, no browser details.
   * @param {{test: string, seed: number, listener?: string, date?: Date|string, headphones?: boolean, nativeLanguage?: string, trials?: object[]}} input
   * @returns {{schema: number, test: string, listener: string, seed: number, date: string, headphones: boolean, nativeLanguage: string|null, trials: object[]}}
   */
  function buildResult(input) {
    const listener = /^[0-9a-f]{8}$/.test(input.listener ?? '')
      ? input.listener
      : randomListener();
    return {
      schema: RESULT_SCHEMA,
      test: String(input.test),
      listener,
      seed: input.seed >>> 0,
      date: formatDate(input.date),
      headphones: input.headphones === true,
      nativeLanguage: normalizeLanguage(input.nativeLanguage),
      trials: (input.trials ?? []).map(cleanRecord),
    };
  }

  /** listening-<test id>-<listener>.json */
  function resultFileName(result) {
    const safe = String(result.test).replace(/[^A-Za-z0-9._-]+/g, '-');
    return `listening-${safe}-${result.listener}.json`;
  }

  /** "Next" of a MUSHRA trial: every condition played, one rated 100. */
  function mushraComplete(names, plays, ratings) {
    return (
      names.every((name) => (plays[name] ?? 0) > 0) &&
      names.some((name) => ratings[name] === 100)
    );
  }

  /** "Next" of an ABX trial: X played once and an answer chosen. */
  function abxComplete(plays, answer) {
    return (plays.x ?? 0) > 0 && (answer === 'a' || answer === 'b');
  }

  /** Seconds between two Date.now() values, to 0.1 s. */
  function elapsed(from, to) {
    return Math.round((to - from) / 100) / 10;
  }

  // -------------------------------------------------------------------------
  // Page. Only start() reads root.document; the helpers below get the
  // document from it through `ui`, so the functions above stay pure.

  /** Small DOM kit shared by the screens: elements, sounds, warnings. */
  function createUi(doc, app) {
    function el(tag, attributes = {}, children = []) {
      const node = doc.createElement(tag);
      for (const [key, value] of Object.entries(attributes)) {
        if (key === 'text') {
          node.textContent = value;
        } else if (key.startsWith('on')) {
          node.addEventListener(key.slice(2), value);
        } else if (value === true) {
          node.setAttribute(key, '');
        } else if (value !== false && value !== undefined && value !== null) {
          node.setAttribute(key, String(value));
        }
      }
      for (const child of [].concat(children)) {
        if (child) {
          node.append(child);
        }
      }
      return node;
    }

    const warning = el('p', { class: 'warning', role: 'alert', hidden: true });
    const warn = (message) => {
      warning.textContent = message;
      warning.hidden = false;
    };
    const player = createPlayer(doc, warn);

    return {
      doc,
      el,
      warning,
      player,
      show(...children) {
        player.stop();
        warning.hidden = true;
        app.replaceChildren(...children.filter(Boolean));
        root.scrollTo?.(0, 0);
      },
      playButton(label, file, onPlay, keepTime = false) {
        const button = el('button', {
          type: 'button',
          class: 'play',
          text: label,
          onclick: () => {
            player.play(file, button, keepTime);
            onPlay?.();
          },
        });
        return button;
      },
      nextButton(onclick) {
        return el('button', {
          type: 'button',
          class: 'next',
          text: 'Next',
          disabled: true,
          onclick,
        });
      },
    };
  }

  function mushraRow(ui, condition, onPlay, onRate, keepTime) {
    const value = ui.el('output', { class: 'value', text: '0' });
    const slider = ui.el('input', {
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      value: 0,
      'aria-label': `Rating of ${condition.label}`,
      oninput: () => {
        value.textContent = slider.value;
        onRate(Number(slider.value));
      },
    });
    return ui.el('div', { class: 'row' }, [
      ui.playButton(
        `Play ${condition.label}`,
        condition.file,
        onPlay,
        keepTime
      ),
      slider,
      value,
    ]);
  }

  /** MUSHRA screen (BS.1534-3); `done(record)` when Next is pressed. */
  function showMushra(ui, trial, progress, done) {
    const speaker = trial.rating === 'speaker';
    const shown = Date.now();
    const names = trial.conditions.map((condition) => condition.name);
    const plays = Object.fromEntries(names.map((name) => [name, 0]));
    const ratings = Object.fromEntries(names.map((name) => [name, 0]));
    const next = ui.nextButton(() =>
      done({
        id: trial.id,
        type: 'mushra',
        order: names,
        ratings: { ...ratings },
        plays: { ...plays },
        seconds: elapsed(shown, Date.now()),
      })
    );
    const update = () => {
      next.disabled = !mushraComplete(names, plays, ratings);
    };
    const rows = trial.conditions.map((condition) =>
      mushraRow(
        ui,
        condition,
        () => {
          plays[condition.name]++;
          update();
        },
        (rating) => {
          ratings[condition.name] = rating;
          update();
        },
        !speaker
      )
    );
    const scale = ui.el(
      'div',
      { class: speaker ? 'scale speaker' : 'scale', 'aria-hidden': 'true' },
      (speaker
        ? SPEAKER_SCALE
        : SCALE.map(({ label, from, to }) => `${label} (${from}-${to})`)
      ).map((text) => ui.el('span', { text }))
    );
    ui.show(
      progress,
      ui.el('h2', { text: speaker ? 'Same speaker?' : 'Rate the versions' }),
      ui.el('p', {
        class: 'instruction',
        text: speaker ? TEXT.speaker : TEXT.mushra,
      }),
      trial.text ? ui.el('p', { class: 'sentence', text: trial.text }) : null,
      ui.el('div', { class: 'controls' }, [
        ui.playButton('Reference', trial.reference, null, !speaker),
        ui.el('button', {
          type: 'button',
          text: 'Stop',
          onclick: () => ui.player.stop(),
        }),
      ]),
      ui.el('div', { class: 'mushra' }, [scale, ...rows]),
      ui.warning,
      next
    );
  }

  /** ABX screen; `done(record)` when Next is pressed. */
  function showAbx(ui, trial, progress, done) {
    const shown = Date.now();
    const plays = { a: 0, b: 0, x: 0 };
    let answer = null;
    const next = ui.nextButton(() =>
      done({
        id: trial.id,
        type: 'abx',
        x: trial.x,
        answer,
        correct: answer === trial.x,
        plays: { ...plays },
        seconds: elapsed(shown, Date.now()),
      })
    );
    const update = () => {
      next.disabled = !abxComplete(plays, answer);
    };
    const files = { a: trial.a, b: trial.b, x: trial[trial.x] };
    const buttons = ['a', 'b', 'x'].map((key) =>
      ui.playButton(`Play ${key.toUpperCase()}`, files[key], () => {
        plays[key]++;
        update();
      })
    );
    const choices = ['a', 'b'].map((key) =>
      ui.el('label', { class: 'choice' }, [
        ui.el('input', {
          type: 'radio',
          name: 'abx',
          value: key,
          onchange: () => {
            answer = key;
            update();
          },
        }),
        ` X is ${key.toUpperCase()}`,
      ])
    );
    ui.show(
      progress,
      ui.el('h2', { text: 'Which one is X?' }),
      ui.el('p', { class: 'instruction', text: TEXT.abx }),
      ui.el('div', { class: 'controls' }, buttons),
      ui.el('fieldset', { class: 'answers' }, [
        ui.el('legend', { text: 'Your answer' }),
        ...choices,
      ]),
      ui.warning,
      next
    );
  }

  /** Intelligibility screen; `done(record)` when Next is pressed. */
  function showIntelligibility(ui, trial, progress, done) {
    const shown = Date.now();
    let plays = 0;
    const label = () => `Play (${trial.maxPlays - plays} left)`;
    const input = ui.el('input', {
      type: 'text',
      class: 'typed',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'The words you heard',
    });
    const next = ui.nextButton(() =>
      done({
        id: trial.id,
        type: 'intelligibility',
        typed: input.value.trim(),
        plays,
        seconds: elapsed(shown, Date.now()),
      })
    );
    const play = ui.el('button', {
      type: 'button',
      class: 'play',
      text: label(),
      onclick: () => {
        if (plays >= trial.maxPlays) {
          return;
        }
        plays++;
        ui.player.play(trial.audio, play);
        play.textContent = label();
        play.disabled = plays >= trial.maxPlays;
        next.disabled = false;
      },
    });
    ui.show(
      progress,
      ui.el('h2', { text: 'Type what you heard' }),
      ui.el('p', { class: 'instruction', text: TEXT.intelligibility }),
      ui.el('div', { class: 'controls' }, [play]),
      ui.el('label', { class: 'field' }, ['Words: ', input]),
      ui.warning,
      next
    );
  }

  /** "angry" → "Angry": the label of an answer. */
  const labelOf = (name) => name.charAt(0).toUpperCase() + name.slice(1);

  /** Choice screen (issue 55); `done(record)` when Next is pressed. */
  function showChoice(ui, trial, progress, done) {
    const shown = Date.now();
    let plays = 0;
    let chosen = null;
    const label = () => `Play (${trial.maxPlays - plays} left)`;
    const next = ui.nextButton(() =>
      done({
        id: trial.id,
        type: 'choice',
        chosen,
        correct: chosen === trial.answer,
        plays,
        seconds: elapsed(shown, Date.now()),
      })
    );
    const update = () => {
      next.disabled = !(plays > 0 && chosen !== null);
    };
    const play = ui.el('button', {
      type: 'button',
      class: 'play',
      text: label(),
      onclick: () => {
        if (plays >= trial.maxPlays) {
          return;
        }
        plays++;
        ui.player.play(trial.audio, play);
        play.textContent = label();
        play.disabled = plays >= trial.maxPlays;
        update();
      },
    });
    const choices = trial.choices.map((name) =>
      ui.el('label', { class: 'choice' }, [
        ui.el('input', {
          type: 'radio',
          name: 'choice',
          value: name,
          onchange: () => {
            chosen = name;
            update();
          },
        }),
        ` ${labelOf(name)}`,
      ])
    );
    ui.show(
      progress,
      ui.el('h2', { text: 'Which emotion do you hear?' }),
      ui.el('p', { class: 'instruction', text: TEXT.choice }),
      ui.el('div', { class: 'controls' }, [play]),
      ui.el('fieldset', { class: 'answers' }, [
        ui.el('legend', { text: 'Your answer' }),
        ...choices,
      ]),
      ui.warning,
      next
    );
  }

  /** Save the result with a Blob and <a download>; nothing is sent. */
  function download(ui, result) {
    const blob = new root.Blob([`${JSON.stringify(result, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = root.URL.createObjectURL(blob);
    const link = ui.el('a', { href: url, download: resultFileName(result) });
    ui.doc.body.append(link);
    link.click();
    link.remove();
    root.setTimeout(() => root.URL.revokeObjectURL(url), 60000);
  }

  function showEnd(ui, result) {
    ui.show(
      ui.el('h2', { text: 'Thank you' }),
      ui.el('p', { text: 'The test is finished.' }),
      ui.el('button', {
        type: 'button',
        class: 'next',
        text: 'Download results',
        onclick: () => download(ui, result),
      }),
      ui.el('p', { class: 'instruction', text: TEXT.end })
    );
  }

  /** Start screen; `begin({headphones, nativeLanguage})` on Start. */
  function showStart(ui, config, begin) {
    const { el } = ui;
    const headphones = el('input', { type: 'checkbox' });
    const language = el('input', {
      type: 'text',
      maxlength: 2,
      size: 3,
      autocomplete: 'off',
      pattern: '[A-Za-z]{2}',
    });
    ui.show(
      el('h1', { text: config.title ?? 'Listening test' }),
      isText(config.instructions)
        ? el('p', { class: 'instruction', text: config.instructions })
        : null,
      el('p', { class: 'consent', text: TEXT.consent }),
      el('label', { class: 'field' }, [headphones, ' I am using headphones']),
      el('label', { class: 'field' }, [
        'Native language (two letters, optional): ',
        language,
      ]),
      isText(config.volume)
        ? el('div', { class: 'controls' }, [
            ui.playButton('Play volume check sound', config.volume),
            el('span', {
              text: ' Set the volume so that this sound is comfortable.',
            }),
          ])
        : null,
      ui.warning,
      el('button', {
        type: 'button',
        class: 'next',
        text: 'Start',
        onclick: () =>
          begin({
            headphones: headphones.checked,
            nativeLanguage: normalizeLanguage(language.value),
          }),
      })
    );
  }

  function showErrors(ui, errors) {
    ui.show(
      ui.el('h1', { text: 'The test cannot start' }),
      ui.el(
        'ul',
        { class: 'errors' },
        errors.map((error) => ui.el('li', { text: error }))
      )
    );
  }

  const SCREENS = {
    mushra: showMushra,
    abx: showAbx,
    intelligibility: showIntelligibility,
    choice: showChoice,
  };

  /**
   * Run the test in the page: start screen, the planned trials, end screen.
   * @param {{document?: Document, config?: object, container?: Element}} [options]
   * @returns {object} the session (plan, records and, at the end, result)
   */
  function start(options = {}) {
    const doc = options.document ?? root.document;
    const config = options.config ?? root.LISTENING_TEST_CONFIG;
    const ui = createUi(doc, options.container ?? doc.getElementById('app'));
    const session = { records: [] };

    function showTrial(index) {
      const trial = session.plan.trials[index];
      if (!trial) {
        session.result = buildResult({
          test: config.id,
          seed: session.plan.seed,
          headphones: session.headphones,
          nativeLanguage: session.nativeLanguage,
          trials: session.records,
        });
        showEnd(ui, session.result);
        return;
      }
      const progress = ui.el('p', {
        class: 'progress',
        text: `Trial ${index + 1} of ${session.plan.trials.length}`,
      });
      SCREENS[trial.type](ui, trial, progress, (record) => {
        session.records.push(record);
        showTrial(index + 1);
      });
    }

    const errors =
      config === undefined
        ? [
            'config.js was not found. Build the test first: ' +
              'node scripts/listening-test.mjs build --sentences <file> ' +
              '--out examples/listening-test',
          ]
        : validateConfig(config);
    if (errors.length > 0) {
      showErrors(ui, errors);
      return session;
    }
    showStart(ui, config, (answers) => {
      Object.assign(session, answers);
      session.plan = planSession(config);
      showTrial(0);
    });
    return session;
  }

  /**
   * One <audio> element per file; one sound plays at a time. With
   * `keepTime` the new sound continues at the time where the previous one
   * was, so a MUSHRA listener can switch between versions mid-sentence.
   */
  function createPlayer(doc, warn) {
    const elements = new Map();
    let current = null;
    let button = null;

    function audioFor(file) {
      let audio = elements.get(file);
      if (!audio) {
        audio = doc.createElement('audio');
        audio.preload = 'auto';
        audio.src = file;
        audio.addEventListener('ended', () => mark(null));
        audio.addEventListener('error', () => warn(TEXT.notLoaded));
        elements.set(file, audio);
      }
      return audio;
    }

    function mark(next) {
      button?.classList.remove('playing');
      button = next;
      button?.classList.add('playing');
    }

    return {
      play(file, source, keepTime = false) {
        const audio = audioFor(file);
        let time = 0;
        if (current && !current.paused && keepTime) {
          time = current.currentTime;
        }
        current?.pause();
        const length = Number.isFinite(audio.duration) ? audio.duration : time;
        audio.currentTime = Math.min(time, length);
        current = audio;
        mark(source);
        const playing = audio.play();
        // Switching sounds pauses a play() that has not started yet; the
        // browser then rejects it with an AbortError, which is no failure.
        playing?.catch?.((error) => {
          if (error?.name !== 'AbortError') {
            warn(TEXT.notPlayed);
          }
        });
      },
      stop() {
        current?.pause();
        mark(null);
      },
    };
  }

  root.ListeningTest = Object.freeze({
    TYPES,
    MAX_CONDITIONS,
    RESULT_SCHEMA,
    RECORD_KEYS,
    SCALE,
    TEXT,
    createRandom,
    shuffle,
    randomSeed,
    randomListener,
    validateConfig,
    planSession,
    buildResult,
    formatDate,
    normalizeLanguage,
    resultFileName,
    mushraComplete,
    abxComplete,
    start,
  });
})(globalThis);
