# Vask Skills

[![skills.sh](https://skills.sh/b/vask-dev/skills)](https://skills.sh/vask-dev/skills)

Agent skills for [Vask](https://vask.dev), Pusher-compatible WebSockets and
realtime applications.

## Install

Install the Vask realtime skill:

```bash
npx skills add vask-dev/skills --skill vask-realtime
```

For Codex specifically:

```bash
npx skills add vask-dev/skills --skill vask-realtime --agent codex
```

## Skills

### `vask-realtime`

Use this skill when an agent needs to set up Vask in a JavaScript, TypeScript,
Rails, or other app, replace Pusher, wire `pusher-js` or a Pusher
server SDK, configure private or presence channels, receive webhooks, or debug
realtime WebSocket connections.

Search terms this skill is meant to match: Pusher, WebSockets, realtime,
JavaScript WebSockets, TypeScript WebSockets, Rails realtime, `pusher-js`,
free WebSockets, presence channels, private channels, and webhooks.

## Development

The skill source lives in `skills/vask-realtime/SKILL.md`.

Validate local discovery with:

```bash
npx skills add . --list
```

Install from a local checkout with:

```bash
npx skills add . --skill vask-realtime
```
