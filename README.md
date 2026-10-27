# English Level Assessment

A browser-based English placement test. Candidates answer multiple-choice and fill-in-the-blank questions across the CEFR scale (A1 to C2) and receive an estimated level with a short description of what it means.

![English Level Assessment](docs/screenshot.png)

**[Live demo](https://vaas125.github.io/english-assessment/)**

## Features

- 13 questions spanning all six CEFR levels (A1, A2, B1, B2, C1, C2)
- Two question types: multiple choice and fill in the blank
- A result screen with the estimated level and a plain-language description of each level
- Questions are loaded from a JSON file, so adding or changing content needs no code changes
- Responsive, dependency-free interface; runs entirely in the browser with no backend

## Tech stack

HTML5, CSS3, vanilla JavaScript, JSON, Inter font.

## Run locally

The questions are fetched from `questions.json`, so serve the folder over HTTP rather than opening the file directly:

```bash
npx serve .
```

## Adding questions

Edit [`questions.json`](questions.json). Each entry looks like this:

```json
{
  "id": "1",
  "type": "multiple-choice",
  "question": "They ___ from Spain.",
  "answers": ["is", "are", "am", "be"],
  "correct_answer": "are",
  "level": "A1"
}
```

For typed answers use `"type": "fill-in-the-blank"` and omit `answers`.

## License

[MIT](LICENSE) © Arif Enes
