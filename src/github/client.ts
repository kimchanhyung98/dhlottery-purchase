import * as github from '@actions/github';
import * as core from '@actions/core';

let octokitInstance: ReturnType<typeof github.getOctokit> | null = null;

export function getOctokit() {
  if (octokitInstance) {
    return octokitInstance;
  }

  const token = core.getInput('github-token') || process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error(
      'GitHub token이 없습니다. workflow에서 `with.github-token: ${{ github.token }}` 또는 `env.GITHUB_TOKEN`을 설정해 주세요.'
    );
  }

  octokitInstance = github.getOctokit(token);
  return octokitInstance;
}

export function getRepo() {
  return github.context.repo;
}

export function getContext() {
  return github.context;
}
