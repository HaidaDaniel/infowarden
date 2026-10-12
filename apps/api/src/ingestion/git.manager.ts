import { Injectable } from '@nestjs/common';
import simpleGit from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface GitCloneResult {
  success: boolean;
  branch: string;
  commit: string;
  clonePath: string;
  error?: string;
}

export interface GitPullResult {
  success: boolean;
  branch: string;
  commit: string;
  clonePath: string;
  updated: boolean;
  error?: string;
}

@Injectable()
export class GitManager {
  private readonly clonesRoot: string;

  constructor() {
    this.clonesRoot = process.env.GIT_CLONES_PATH || './git-clones';
    this.ensureClonesRoot();
  }

  private ensureClonesRoot(): void {
    if (!fs.existsSync(this.clonesRoot)) {
      fs.mkdirSync(this.clonesRoot, { recursive: true });
    }
  }

  private getClonePath(repoUrl: string, branch: string): string {
    const sanitizedUrl = repoUrl.replace(/[^a-zA-Z0-9]/g, '-');
    return path.join(this.clonesRoot, `${sanitizedUrl}-${branch}`);
  }

  async clone(
    repoUrl: string,
    branch: string = 'main',
    targetPath?: string
  ): Promise<GitCloneResult> {
    const clonePath = targetPath || this.getClonePath(repoUrl, branch);

    try {
      const git = simpleGit();
      await git.clone(repoUrl, clonePath, ['--branch', branch, '--single-branch']);

      const currentBranch = await simpleGit(clonePath).branchLocal();
      const commit = await simpleGit(clonePath).revparse('HEAD');

      return {
        success: true,
        branch: currentBranch.current,
        commit,
        clonePath,
      };
    } catch (error) {
      return {
        success: false,
        branch: branch,
        commit: '',
        clonePath,
        error: errorMessage(error),
      };
    }
  }

  async pull(
    repoUrl: string,
    branch: string = 'main',
    targetPath?: string
  ): Promise<GitPullResult> {
    const clonePath = targetPath || this.getClonePath(repoUrl, branch);

    try {
      if (!fs.existsSync(clonePath)) {
        return {
          success: false,
          branch: branch,
          commit: '',
          clonePath,
          updated: false,
          error: `Clone path does not exist: ${clonePath}`,
        };
      }

      const git = simpleGit(clonePath);

      await git.fetch();
      await git.checkout(branch);
      const pullResult = await git.pull();

      const currentBranch = await git.branchLocal();
      const commit = await git.revparse('HEAD');

      return {
        success: true,
        branch: currentBranch.current,
        commit,
        clonePath,
        updated: pullResult.summary.changes > 0,
      };
    } catch (error) {
      return {
        success: false,
        branch: branch,
        commit: '',
        clonePath,
        updated: false,
        error: errorMessage(error),
      };
    }
  }

  async getStatus(
    repoUrl: string,
    branch: string = 'main',
    targetPath?: string,
  ): Promise<{
    exists: boolean;
    branch?: string;
    commit?: string;
    clonePath: string;
  }> {
    const clonePath = targetPath || this.getClonePath(repoUrl, branch);

    if (!fs.existsSync(clonePath)) {
      return { exists: false, clonePath };
    }

    try {
      const git = simpleGit(clonePath);
      const currentBranch = await git.branchLocal();
      const commit = await git.revparse('HEAD');

      return {
        exists: true,
        branch: currentBranch.current,
        commit,
        clonePath,
      };
    } catch {
      return { exists: false, clonePath };
    }
  }
}
