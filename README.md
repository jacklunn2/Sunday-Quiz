# The Sunday Quiz

A free Australian general knowledge quiz, published every Sunday. Static site: plain HTML, CSS and JavaScript, no build step and no dependencies.

## Run it locally

    python3 -m http.server 8000

Then open http://localhost:8000. (Opening index.html directly will not work, because the browser blocks loading the quiz files from disk.)

## Publish a new quiz

1. Copy the newest file in `quizzes/` and name it for the Sunday it goes out, e.g. `quizzes/2026-10-18.json`.
2. Edit the 30 questions. The order sets the rounds: questions 1-10 are Australia, 11-20 are The World, 21-30 are Sport & Culture. Each has a `category`, `question`, `answer`, `explanation` and `source`. Players reveal the answer with a button and mark themselves. The `source` is for your own fact-checking and is not shown to players.
3. Add an entry to the top of `quizzes/index.json` with the same `id`, `number`, `date` and `title`, plus a `blurb` and `questionCount`.
4. Run `node tools/validate.mjs` to catch mistakes.
5. Upload. A quiz dated in the future stays hidden until that date (Sydney time), so it can be uploaded ahead of Sunday.

Remove `"sample": true` from real quizzes.

## Layout

    index.html          page shell: masthead, footer
    css/styles.css      all styling; colours and type are tokens at the top
    js/app.js           home, quiz, results and archive views; scoring; saved progress
    quizzes/index.json  list of quizzes shown on the home page and archive
    quizzes/<date>.json one file per quiz
    tools/validate.mjs  content checks

Progress and scores are saved in the visitor's browser (localStorage). There is no server, database or tracking.
