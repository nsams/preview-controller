# Preview Controller

Starts, proxies and stops preview environments on demand. A preview is a checkout of one branch
of one GitHub repository plus the docker compose stack from
[docker-compose.preview.yml](../docker-compose.preview.yml), started with its own port and
reachable under its own subdomain.

## Quick start

```bash
npm install
cp .env.secrets.tpl .env.secrets   # and put a password in it
npm start
```

Open `http://preview.localhost:9000`. Everything is behind one password.

The page has a form for organization, repository and branch, and lists the previews that exist.
Organization and repository are prefilled with the ones used last, because usually only the
branch changes.

Submitting the form goes to the detail page of the new preview, which links to every domain the
project reported - site, admin and whatever else - so you can pick where to go. A running
preview can be stopped from there or straight from the list; it starts again on the next
request. Removing a preview for good is api only, see below.

The same from a script:

```bash
curl "http://preview.localhost:9000/api/previews/start?org=vivid-planet&repo=dextinity-starter&branch=main"
```

The response contains the url the preview will be reachable at. The first start clones the
branch and builds the images, which takes a few minutes; opening the url in the meantime shows
a page that reloads itself until the preview is up, with a link to its log.

## Api

| Method   | Path                                        | Description                                 |
| -------- | ------------------------------------------- | ------------------------------------------- |
| `GET`    | `/`                                         | Start form and a table with cpu and memory  |
| `POST`   | `/previews/start`                           | What the start form submits                 |
| `GET`    | `/previews/:slug`                           | Detail page with the links of one preview   |
| `POST`   | `/previews/:slug/stop`                      | What the stop button submits                |
| `GET`    | `/api/previews`                             | All known previews as json                  |
| `GET`    | `/previews/:slug/logs`                      | Log page of one preview                     |
| `GET`    | `/api/previews/:slug/logs`                  | The same logs as plain text                 |
| `GET`    | `/api/previews/start?org=…&repo=…&branch=…` | Create and start a preview, returns its url |
| `POST`   | `/api/previews/:slug/stop`                  | Stop the containers, keep images and data   |
| `DELETE` | `/api/previews/:slug`                       | Remove containers, volumes and the checkout |

All of them need the session cookie, so a browser has to sign in first. For scripts, sign in
once and reuse the cookie:

```bash
curl -c cookies.txt -d "password=$PREVIEW_PASSWORD" http://preview.localhost:9000/__preview-controller/login
curl -b cookies.txt "http://preview.localhost:9000/api/previews/start?org=vivid-planet&repo=dextinity-starter&branch=main"
```

## Logs

Every preview has a log page at `/previews/<slug>/logs`, linked from the status page and from
the page shown when a start failed. It has two parts:

- the **start log**, what the controller did while checking out, installing, rendering the
  site-configs and running compose, including the error if one of those steps failed
- the **container logs**, `docker compose logs` of the preview, filterable per service

The page reloads itself while a preview is still starting. The same is available as plain text:

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

A preview is identified by GitHub organization, repository and branch, and is cloned from
`https://github.com/<org>/<repo>.git`. All three values are checked against narrow patterns
before they reach a git command line, a directory name or a host name.

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
reverse proxy that terminates tls.

## How it works

```
  browser ──▶ preview-controller (one port)
                 │
                 ├── <baseDomain>              -> status page and api
                 └── *.<slug>.<baseDomain>     -> 127.0.0.1:<preview port>
                                                  └── caddy inside the preview stack
                                                      routes admin./idp./secondary. further
```

- The **slug** is derived from organization, repository and branch. It is the last dns label before the base
  domain, so `admin.<slug>.<baseDomain>` still resolves to the same preview and the caddy inside
  the stack can do its own host based routing on top.
- **Starting** checks out the branch and runs the start script of the repository. That happens
  in the background, the api returns right away.
- **Idle previews** are stopped with `docker compose stop` after `idleTimeoutMinutes` without a
  request. Images and volumes stay, so resuming takes seconds.
- **Previews stopped for long** are deleted after `removeAfterDays` with
  `docker compose down --volumes --rmi local`, which also drops the images that were built for
  them - that is where most of the disk space of a preview sits. How long a preview has been
  stopped comes from docker itself (`State.FinishedAt`), so it survives a restart of the
  controller. The sweep is skipped while docker is unreachable, because then every preview only
  looks stopped.
- **Access to a stopped preview** resumes it and answers with a page that reloads itself. If
  resuming fails, for example because the containers were pruned, a full start is retried.
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
executable `start-preview.sh` in its root that leaves a running docker compose project behind.
It is called with these environment variables:

| Variable               | Meaning                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `COMPOSE_PROJECT_NAME` | The compose project the script has to create                   |
| `PREVIEW_SLUG`         | Short name of the preview                                      |
| `PREVIEW_PORT`         | Host port the preview has to publish                           |
| `PREVIEW_DOMAIN`       | Base domain of the preview, without port                       |
| `PREVIEW_HOST`         | Public host of the preview, including the port if there is one |
| `PREVIEW_SCHEME`       | `http` or `https`                                              |
| `PREVIEW_URLS`         | File the script may report the urls of the preview to          |

Anything else - installing dependencies, rendering configuration, building images - is up to
that script.

A project usually serves more than one domain. To have them show up as links, the script writes
one `<name>=<url>` per line to `$PREVIEW_URLS`:

```bash
cat > "$PREVIEW_URLS" <<EOF
Site=$PREVIEW_SCHEME://$PREVIEW_HOST
Admin=$PREVIEW_SCHEME://admin.$PREVIEW_HOST
EOF
```

The first entry is where the controller sends you after starting a preview. Only `http` and
`https` urls are accepted, everything else in that file is ignored. The file stays in the
checkout, so the links survive a restart of the controller without being stored anywhere else. Everything after the start is done through `docker compose -p <project>`, which
works from the labels of the containers, so the controller never needs the compose file itself.

## Limitations

- Http only towards the previews: websockets and other upgrades are not proxied. The previews
  are production builds, so there is no hot reloading that would need them.
- Nothing prunes the shared build cache. `docker builder prune` is left to the host, because a
  controller cannot tell which of it belongs to other workloads on the same daemon.
- A failed start is only remembered in memory. After a controller restart the preview simply
  looks stopped again; the reason is still in its log.
- One controller process manages the docker daemon it runs on. There is no scheduling across
  hosts and no limit on how many previews run at once beyond the port range.
- The status page polls `docker stats`, which takes a moment when many containers run.
- Stopping and removing are not confirmed anywhere, the api trusts whoever has the password.
