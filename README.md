# The Sunday Quiz

A free Australian general knowledge quiz, published every Sunday. Static site: plain HTML, CSS and JavaScript, no build step and no dependencies.

## Run it locally

    python3 -m http.server 8000

Then open http://localhost:8000. (Opening index.html directly will not work, because the browser blocks loading the quiz files from disk.)

## Publish a new quiz

Use the editor at `/admin.html` (for example https://jacklunn2.github.io/Sunday-Quiz/admin.html).

1. The first time on each computer, open "Publishing access" and paste a GitHub fine-grained access key with Contents: Read and write on this repository. The editor shows the steps. The key stays in that browser.
2. Press New quiz. The number and next Sunday's date are filled in.
3. Write the 30 questions in three rounds: Australia (1-10), The World (11-20), Sport & Culture (21-30). Each has a question, answer, explanation, topic label and a private source note. Drafts save in the browser as you type.
4. Preview, then Publish. The editor writes the quiz file and updates the quiz list on GitHub; GitHub Pages rebuilds the site within a few minutes. A quiz dated in the future stays hidden until that Sunday (Sydney time).

Published quizzes can be edited the same way. The release date of a published quiz is locked.

To edit files by hand instead: add `quizzes/<date>.json`, add a matching entry to `quizzes/index.json`, and run `node tools/validate.mjs`.

Note: the repository is public, so a scheduled quiz can be read on GitHub before its release date by anyone who looks.

## Layout

    index.html          page shell: masthead, footer
    css/styles.css      all styling; colours and type are tokens at the top
    js/app.js           home, quiz, results and archive views; scoring; saved progress
    admin.html          private editor page (not linked from the site)
    js/admin.js         editor: drafts, preview, publishing to GitHub
    css/admin.css       editor styles
    quizzes/index.json  list of quizzes shown on the home page and archive
    quizzes/<date>.json one file per quiz
    tools/validate.mjs  content checks

Progress and scores are saved in the visitor's browser (localStorage). There is no server, database or tracking.
