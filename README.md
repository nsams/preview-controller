# Preview Controller

Starts, proxies and stops preview environments on demand. A preview is a checkout of one branch
of one GitHub repository plus the docker compose stack from
[.docker-preview/docker-compose.yml](../.docker-preview/docker-compose.yml), started with its own port and
reachable under its own subdomain.

## Quick start

```bash
npm install
cp .env.secrets.tpl .env.secrets   # and put a password in it
npm run build                      # the frontend
npm start
```

Open `http://preview.localhost:9000`. Everything is behind one password.

The page has a form for organization, repository, branch and an optional start script, and lists
the previews that exist. Everything but the branch is prefilled with the one used last, because
usually only the branch changes.

The list links to the detail page of every preview, which is where the domains the project
reported - site, admin and whatever else - can be opened, and where it is started, restarted,
stopped and deleted:

- **Start** brings a stopped preview back up. It is what a request to a stopped preview does
  anyway, so for those the button only saves opening the preview to wake it. For a preview whose
  start failed it is the only way back up, because nothing retries that on its own.
- **Restart** does the same while the preview runs, and is how it picks up the commits pushed
  since it was started - a restart fetches the branch and rebuilds, so it pulls. Compose only
  recreates the containers whose image or configuration actually changed. When the fetch brings
  nothing, nothing is rebuilt either: the containers are simply restarted, which takes seconds.
- **Stop** keeps the images and the data; the preview starts again on the next request.
- **Delete** throws containers, volumes and checkout away for good. Only offered once a preview
  is stopped.

The same from a script:

```bash
curl "http://preview.localhost:9000/api/previews/start?org=vivid-planet&repo=dextinity-starter&branch=main"
```

The response contains the url the preview will be reachable at. The first start clones the
branch and builds the images, which takes a few minutes; opening the url in the meantime shows
a page that reloads itself until the preview is up, with a link to its log.

## Security

Only use the controller for repositories you trust. Starting a preview means running
`start-preview.sh` of that repository and building and running its docker compose stack on the
host - code from the repository, executed with the rights of the controller and with access to
the docker daemon, which is as good as root on the host. Nothing is sandboxed: a malicious or
compromised branch can read the other previews, the checkouts, the GitHub token and anything else
the host can reach.

So:

- Only make repositories previewable whose every branch you would also run on your own machine.
  Do not point it at repositories where outsiders can push branches, and do not preview pull
  requests from forks.
- Scope `PREVIEW_CONTROLLER_GITHUB_TOKEN` to exactly those repositories (see
  [Private repositories](#private-repositories)) - there is no allow-list beyond what the token
  can read.
- Treat the password as access to the host. Anyone who has it can start a preview of any
  repository the token or the host can reach.
- Run the controller on a host dedicated to previews, not next to anything that matters.

## Api

The ui is the react frontend (see below) at `/` and `/previews/<slug>`.
It works with the same json api a script would use:

| Method   | Path                                                   | Description                                                    |
| -------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| `GET`    | `/api/previews`                                        | All known previews as json                                     |
| `POST`   | `/api/previews`                                        | Create and start a preview from `{org, repo, branch, script?}` |
| `GET`    | `/api/previews/start?org=…&repo=…&branch=…[&script=…]` | The same as a get, for scripts                                 |
| `GET`    | `/api/previews/:slug`                                  | One preview, with the links it reported                        |
| `POST`   | `/api/previews/:slug/start`                            | Bring a stopped or failed preview back up                      |
| `POST`   | `/api/previews/:slug/restart`                          | Fetch, rebuild and restart a running preview                   |
| `POST`   | `/api/previews/:slug/stop`                             | Stop the containers, keep images and data                      |
| `DELETE` | `/api/previews/:slug`                                  | Remove containers, volumes and the checkout                    |
| `GET`    | `/api/previews/:slug/services`                         | The compose services of a preview and their state              |
| `GET`    | `/api/previews/:slug/logs`                             | Start log or container logs as plain text                      |
| `GET`    | `/api/usage`                                           | Cpu and memory of every running preview by slug                |

Next to the api, `GET /open/<org>/<repo>/<branch>` starts a preview like `/api/previews/start` and
redirects the browser to it - the link of the [GitHub action](#link-from-github).

All of them need the session cookie, so a browser has to sign in first. For scripts, sign in
once and reuse the cookie:

```bash
curl -c cookies.txt -d "password=$PREVIEW_PASSWORD" http://preview.localhost:9000/__preview-controller/login
curl -b cookies.txt "http://preview.localhost:9000/api/previews/start?org=vivid-planet&repo=dextinity-starter&branch=main"
```

## Frontend

The ui of the controller is a react app in [frontend/](frontend), built with vite and
[mui](https://mui.com/material-ui/), with the theme and components of `@dextinity/admin` on top -
like the admin of [dextinity-starter](https://github.com/vivid-planet/dextinity-starter/tree/main/admin).
That pins mui to 7 and react-router to 5, the versions `@dextinity/admin` supports, and brings
its other peer dependencies (apollo, final-form, react-intl, the mui x packages, ...) along even
though only the theme, layout, buttons, alerts and fields are used. The controller serves the build from `frontend/dist` on the
base domain, behind the same password, and answers every path that is not a file or under `/api`
with its `index.html`, so the frontend does the routing. The only pages still rendered by the
controller itself are the ones a preview host shows in place of the preview - starting, failed,
unknown - and the login, because all of them have to work on every host.

The api lives in [src/api.ts](src/api.ts) as one chained hono app. The frontend imports only its
type and talks to it through hono's typed client (`hc<ApiType>`), so paths, parameters and response
shapes are checked by `npm run lint` on both sides - there are no hand-written copies of the api
types. A route only shows up in that type when it is chained onto the others.

```bash
npm run build          # writes frontend/dist, which npm start serves
npm run dev            # controller with --watch and vite with hot reloading, in dev-process-manager
npm run dev:backend    # only the controller, passing the frontend on to vite
npm run dev:frontend   # only vite
```

`npm run dev` starts both scripts from [dev-pm.config.ts](dev-pm.config.ts) in a background daemon
and returns. `npx dev-pm logs`, `npx dev-pm restart backend` and `npx dev-pm shutdown` work with
them afterwards.

Open the controller as usual, `http://preview.localhost:9000/`. `npm run dev:backend` sets
`PREVIEW_CONTROLLER_FRONTEND_DEV_SERVER_PORT=5173`, so instead of `frontend/dist` the controller
passes every request for the frontend on to vite, behind the same password - every link of the
controller, the ones on the starting and failed pages of a preview included, ends up in the dev
server. Only the hot reload websocket connects to vite on port 5173 directly.

## Linting

The lint setup follows the [Dextinity starter](https://github.com/vivid-planet/dextinity-starter):
prettier, eslint with `@dextinity/eslint-config` (the node config for the controller, the react
config without the admin and translation rules for the frontend), knip for unused files, exports
and dependencies, and tsc for both sides. `npm install` sets up a husky pre-commit hook that runs
lint-staged, and the lint workflow runs the same checks on every pull request.

```bash
npm run lint       # all checks
npm run lint:fix   # eslint --fix and prettier --write
```

## Logs

The detail page of a preview, `/previews/<slug>`, shows its logs below the links, facts and
actions. It is linked from the status page and from the page shown when a start failed. The logs
are one card with a tab for each source - the start log first, set apart by a line, then the
containers:

- the **start log**, what the controller did while checking out, installing, rendering the
  site-configs and running compose, including the error if one of those steps failed. The output
  of `start-preview.sh` is written while it runs, so the first start - which pulls and builds
  the images and has no containers to show yet - can be followed line by line. It is cleared at
  the beginning of every start, so it always shows the latest run only.
- the **container logs**, `docker compose logs` of the preview, filterable per service. They
  begin at the start they belong to: every start and restart notes the time and the log is asked
  for that window only, because compose recreates only the containers that actually changed and
  the ones it leaves alone would otherwise still carry the output of the run before. A preview
  that was already running when the controller came up has no such cut-off and shows everything.
  Every service has a tab of its own next to "All containers", coloured by the state of its
  containers: red for a failing one, amber while it is still coming up. A failing
  service also spells its state out next to its name (`exited (1)`, `restarting (exit 1)`,
  `unhealthy`) and is listed above the tabs, because a container that keeps crashing is
  restarted by compose - the preview as a whole stays "running" while one of its services never
  comes up.

The page keeps itself up to date while a preview is still starting, and while a container is failing. The
same is available as plain text:

```bash
curl -b cookies.txt "http://preview.localhost:9000/api/previews/<slug>/logs?source=start"
curl -b cookies.txt "http://preview.localhost:9000/api/previews/<slug>/logs?service=api&tail=500"
```

`source` is `containers` (default) or `start`, `tail` defaults to 200 lines.

## Configuration

Everything comes from the environment. `.env` holds the defaults and is committed, `.env.local`
overrides them for one machine, and `.env.secrets` holds the password - the last two are not
committed. Variables that are already set in the shell win over all of them.

| Variable                                  | Default       | Description                                                       |
| ----------------------------------------- | ------------- | ----------------------------------------------------------------- |
| `PREVIEW_CONTROLLER_PORT`                 | `9000`        | Port the controller listens on, the only published port           |
| `PREVIEW_CONTROLLER_BASE_DOMAIN`          | -             | Previews live on `<slug>.<base domain>`, the controller on itself |
| `PREVIEW_CONTROLLER_SCHEME`               | `http`        | `http` or `https`, for urls and secure cookies                    |
| `PREVIEW_CONTROLLER_PASSWORD`             | -             | Shared password, belongs in `.env.secrets`                        |
| `PREVIEW_CONTROLLER_IDLE_TIMEOUT_MINUTES` | `60`          | Stop a preview after this long without a request                  |
| `PREVIEW_CONTROLLER_REMOVE_AFTER_DAYS`    | `7`           | Delete a preview stopped this long, `0` switches the cleanup off  |
| `PREVIEW_CONTROLLER_PORT_RANGE`           | `31000-31099` | Range the per-preview ports are taken from                        |
| `PREVIEW_CONTROLLER_DATA_DIR`             | `./data`      | Checkouts and logs                                                |

A preview is identified by GitHub organization, repository, branch and start script, and is cloned
from `https://github.com/<org>/<repo>.git`. All four values are checked against narrow patterns
before they reach a git command line, a file name or a host name.

### Private repositories

Set `PREVIEW_CONTROLLER_GITHUB_TOKEN` to a fine-grained personal access token with read access
to the contents of the repositories that should be previewable. The token is handed to git
through `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader`, so it never appears in a
command line where other users of the machine could read it in `ps`, and it is never written to
disk. It is also masked in everything the controller logs or renders, in case git echoes a url
that contains it.

Without a token, only public repositories work, plus whatever the git configuration of the host
can authenticate on its own.

There is no allow-list of repositories: whoever knows the password can start a preview of any
repository the token or the host can reach, and that preview builds and runs the code of that
repository. Scoping the token to the repositories that should be previewable is what keeps this
narrow - a fine-grained token can be limited to single repositories. A GitHub App installation
would do the same job with short lived tokens and without hanging off a personal account.

`*.localhost` resolves to `127.0.0.1` in all current browsers, which is enough for local use.
For a real deployment point a wildcard dns record at the host and put the controller behind a
reverse proxy that terminates tls. One wildcard is enough, because every host of a preview is a
single label under the base domain - see below.

## How it works

```
  browser ──▶ preview-controller (one port)
                 │
                 ├── <baseDomain>                   -> frontend and api
                 └── [<name>--]<slug>.<baseDomain>  -> 127.0.0.1:<preview port>
                                                       └── caddy inside the preview stack
                                                           routes admin--/idp--/… further
```

- The **slug** is derived from organization, repository, branch and start script, and is the dns
  label of the preview. A preview with the default start script has the slug it always had.
- **Everything a preview serves is one label below the base domain.** The preview itself is
  `<slug>.<baseDomain>`, everything else it serves is `<name>--<slug>.<baseDomain>` - `admin--`,
  `idp--`, and whatever domains the project itself has. A wildcard certificate covers one label
  only, so `admin.<slug>.<baseDomain>` would need a second one for every preview; with the flat
  names a single `*.<baseDomain>` certificate serves all previews and all their hosts. A slug
  never contains `--`, so the controller reads the slug back from behind the last one. The older
  `<name>.<slug>.<baseDomain>` spelling is still routed, for projects that have not been changed
  over - but it is exactly what has no certificate.
- **Starting** checks out the branch and runs the start script of the repository. That happens
  in the background, the api returns right away. Before a new preview is created, a quick check -
  `git ls-remote` and a fetch of the trees of the branch tip, without any file contents - makes
  sure the repository and branch exist and the start script is there and executable. Otherwise
  the form or the api answers with the error right away, and no preview is created.
- **Idle previews** are stopped with `docker compose stop` after `idleTimeoutMinutes` without a
  request. Images and volumes stay, so the next start reuses them.
- **Deleting a stopped preview** does the same as that sweep, on demand: the detail page of a
  stopped preview has a delete button, so a branch that is done does not have to wait for
  `removeAfterDays` to free its disk space. A running preview has to be stopped first.
- **Previews stopped for long** are deleted after `removeAfterDays` with
  `docker compose down --volumes --rmi local`, which also drops the images that were built for
  them - that is where most of the disk space of a preview sits. How long a preview has been
  stopped comes from docker itself (`State.FinishedAt`), so it survives a restart of the
  controller. The sweep is skipped while docker is unreachable, because then every preview only
  looks stopped.
- **A failed start is never retried on its own.** The preview stays failed until someone presses
  start on its detail page, so a broken branch does not rebuild itself over and over. Opening it
  shows the error and a link to the log; reloading that page does not start anything.
- **Access to a stopped preview** starts it again and answers with a page that reloads itself.
  A restart is the same path as a first start - fetch the branch, run the start script, build,
  up - so a preview never comes back showing code that has been pushed over in the meantime.
- **A fetch that brings nothing skips the build.** Every start begins with a fetch, and the start
  script only runs when the containers that are there were not built from exactly this commit.
  Otherwise they are started again, which takes seconds instead of minutes. Which commit they were
  built from is what the start writes to `.preview-commit` in the checkout after the script
  succeeded - untracked, so a `git checkout --force` leaves it alone. The script therefore still
  runs for a commit it never got through for, when there are no containers left to start, and
  after a failed attempt, where nothing changed in git either and building is exactly what has to
  be tried again. That also keeps the reported urls right: the script is what writes
  `.preview-urls`, so a preview may never skip it for a commit it has not reported for. Only a
  preview whose checkout is gone is resumed with `docker compose start`, because there is nothing
  left to build from.
- **State** is not stored anywhere. The list of previews is discovered from docker - every
  compose project whose name starts with `preview-` - and from the checkouts, which git can be
  asked for their repository and branch and which hold the urls a project reported. The only thing kept in memory is when a preview was
  last requested, because nothing else can know that. After a restart every running preview
  therefore gets a fresh idle period, which is cheaper than wrongly stopping everything.
- **Authentication** is a single shared password. Signing in sets a signed cookie on the base
  domain, which makes it valid for all preview subdomains including iframes. The cookie is
  stripped again before a request is passed to a preview.

## What a project has to provide

The controller knows nothing about the projects it starts. A repository only has to contain an
executable start script that leaves a running docker compose project behind. By default that is
`start-preview.sh` in its root; a repository that keeps it elsewhere, or has several setups, names
it when a preview is started:

```bash
curl -b cookies.txt "http://preview.localhost:9000/api/previews/start?org=nsams&repo=preview-controller&branch=main&script=example/start-preview.sh"
```

The script is a path relative to the root of the repository, without `.` or `..` segments. It is
part of what identifies a preview - the same branch with two scripts is two previews - and is kept
in `.preview-script` in the checkout, because git cannot tell. It runs in its own directory, so a
script below the root finds its compose file next to it. It is called with these environment
variables:

| Variable               | Meaning                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `COMPOSE_PROJECT_NAME` | The compose project the script has to create                   |
| `PREVIEW_SLUG`         | Short name of the preview                                      |
| `PREVIEW_PORT`         | Host port the preview has to publish                           |
| `PREVIEW_DOMAIN`       | Base domain of the preview, without port                       |
| `PREVIEW_HOST`         | Public host of the preview, including the port if there is one |
| `PREVIEW_SCHEME`       | `http` or `https`                                              |
| `PREVIEW_URLS`         | File the script may report the urls of the preview to          |

[example/](example) is a minimal project that does exactly that - started with the request above -
and can be copied as a starting point.

Anything else - installing dependencies, rendering configuration, building images - is up to
that script. Whatever it writes to stdout or stderr ends up in the start log of the preview as
it appears, so progress of a long build is visible right away.

A project usually serves more than one domain. Those have to be named `<name>--$PREVIEW_HOST`
and not `<name>.$PREVIEW_HOST`, so that they stay one label under the base domain and a single
wildcard certificate covers them. To have them show up as links, the script writes one
`<name>=<url>` per line to `$PREVIEW_URLS`:

```bash
cat > "$PREVIEW_URLS" <<EOF
Site=$PREVIEW_SCHEME://$PREVIEW_HOST
Admin=$PREVIEW_SCHEME://admin--$PREVIEW_HOST
EOF
```

The first entry is where the controller sends you after starting a preview. Only `http` and
`https` urls are accepted, everything else in that file is ignored. The file stays in the
checkout, so the links survive a restart of the controller without being stored anywhere else. Everything after the start is done through `docker compose -p <project>`, which
works from the labels of the containers, so the controller never needs the compose file itself.

## Link from GitHub

[github-action/action.yml](github-action/action.yml) is a reusable action for the repositories that get previewed. It starts
nothing. All it does is add a commit status, shown in the checks of a pull request, whose
details link points to `/open/<org>/<repo>/<branch>` on the controller. Following that link starts
the preview of the branch, or only opens it when it already runs, and sends the browser to it -
through the page that reloads itself while the preview is still coming up. Without a session the
login comes first and leads back to the link.

```yaml
# .github/workflows/preview.yml in the previewed repository
name: Preview

on:
    pull_request:

permissions:
    statuses: write

jobs:
    preview:
        runs-on: ubuntu-latest
        steps:
            - uses: nsams/preview-controller/github-action@main
              with:
                  controller-url: https://preview.example.com
```

Organization, repository and branch default to the ones the workflow runs for, the status is
added to the head commit of the pull request. `context` and `description` change how the status
is labelled. Pull requests from forks get no status, because they are never previewed (see
[Security](#security)).

## Tests

```bash
npm test                          # unit tests, src/*.test.ts
npx playwright install chromium   # once
npm run test:e2e                  # end-to-end tests, e2e/*.spec.ts
```

The unit tests use the test runner of node and need nothing else.

The end-to-end tests build the frontend, start the real controller and drive it through http and
a browser, so they need docker. They preview [e2e/fixture-project](e2e/fixture-project), a `start-preview.sh` with a
compose file and an app that answers every request with what it received. Instead of GitHub, it is
cloned from a bare repository on disk, through a git `insteadOf` rewrite in the environment of the
controller. Every test pushes a branch of its own and deletes its previews afterwards. A chromium
that is installed elsewhere can be used with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Both run in GitHub Actions on every push, see [.github/workflows/test.yml](.github/workflows/test.yml).

## Limitations

- Http only towards the previews: websockets and other upgrades are not proxied. The previews
  are production builds, so there is no hot reloading that would need them.
- Nothing prunes the shared build cache. `docker builder prune` is left to the host, because a
  controller cannot tell which of it belongs to other workloads on the same daemon.
- A failed start is only remembered in memory. After a controller restart the preview simply
  looks stopped again; the reason is still in its log.
- One controller process manages the docker daemon it runs on. There is no scheduling across
  hosts and no limit on how many previews run at once beyond the port range.
- The frontend polls `docker stats`, which takes a moment when many containers run.
- Removing is confirmed in the browser, but the api trusts whoever has the password.
