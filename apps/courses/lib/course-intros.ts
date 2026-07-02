// Per-course "Introduction" content (aka Lesson 0). Returns markdown for the
// (course, native) pair, or null when no intro is authored.
//
// classic50 reuses the long-form Glottos Matrix method article that used to
// live on the front page. Other courses get a course-specific blurb.
import { METHOD_ARTICLES } from './method-article';
import type { CourseSlug, NativeLang } from './content-types';

const LOSREDEN50_INTRO_RU = `# Loslegen 50 — введение

Курс «Loslegen 50» — это путь от первых немецких фраз к свободному устному общению на уровне B1. Он построен иначе, чем классический Glottos Matrix: фокус — на разговорной беглости, а не на построении грамматического каркаса с нуля.

## Чем этот курс отличается

- **50 юнитов, 150 текстов для аудирования.** Каждый юнит сопровождается тремя короткими аудио-текстами — три варианта одной ситуации, три голоса, три точки входа в тему.
- **Произведение, а не воспроизведение.** В упражнениях ты не «вставляешь слово», а порождаешь немецкое предложение целиком. Ключи в конце разделов нужны только для самопроверки.
- **Этапы и контрольные смотры.** Юниты сгруппированы в стадии — после каждой ты проходишь сводный юнит и видишь, что закрепилось, а что нужно повторить.
- **AI-проверка ответов.** Если твой ответ не совпал дословно с эталоном, но передаёт тот же смысл — он будет засчитан. Подсказка объяснит, что именно стоит подтянуть.

## Что нужно перед стартом

Курс рассчитан на учеников, которые уже знают самые азы — алфавит, чтение, базовые местоимения и глагол sein. Если ты с нуля — пройди сначала Glottos Matrix Classic 50 (он есть в списке курсов), и возвращайся сюда за беглостью.

## Как заниматься

1. Открой юнит. Прочитай Раздел 1 — он короткий и собирает одну тему.
2. Сделай письменные упражнения. Не подсматривай в ключи, пока не напишешь свой вариант.
3. Послушай все три аудио-текста. Не пытайся понять каждое слово — лови контекст.
4. Перейди к следующему юниту, когда чувствуешь, что без подсказок строишь нужные фразы.

Reden ist wichtig. So lernen wir uns kennen. Tschüss, bis bald!
`;

export function getCourseIntro(course: CourseSlug, native: NativeLang): string | null {
  if (course === 'classic50') {
    return (METHOD_ARTICLES as Record<string, string>)[native] ?? METHOD_ARTICLES.en;
  }
  if (course === 'losreden50') {
    // losreden50 is currently Russian-native only; English and Polish
    // speakers haven't been authored yet.
    return native === 'ru' ? LOSREDEN50_INTRO_RU : null;
  }
  return null;
}
