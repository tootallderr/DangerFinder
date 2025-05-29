#!/usr/bin/env python3
import os
import sys
import subprocess
import logging
from datetime import datetime
from time import sleep
import platform
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Set up logging
console_handler = logging.StreamHandler(sys.stdout)
file_handler = logging.FileHandler("sync_log.txt", mode='a', encoding='utf-8')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[console_handler, file_handler]
)
logger = logging.getLogger("github_sync")

# CONFIG
REPO_PATH = os.path.abspath(os.path.dirname(__file__))
REMOTE_URL = "https://github.com/tootallderr/DangerFinder.git"  # Updated to new repo
COMMIT_MESSAGE = f"\U0001F4E6 v0.2 Update with Enhanced UI and Error Handling - {datetime.now().strftime('%Y-%m-%d')}"
DEFAULT_BRANCH = "master"  # Changed from "main" to match your actual branch
LOG_FILE_PATH = os.path.join(REPO_PATH, "sync_log.txt")

# Files to ensure exist and are tracked (only files that actually exist in the codebase)
CORE_FILES = [
    "README.md",
    "CHANGELOG.md",
    "sync_to_github.py",
    "package.json",
]

# Optional files (will be tracked if they exist, but won't cause errors if missing)
OPTIONAL_FILES = [
    ".gitignore",
    "LICENSE",
    "ALIAS_CONNECTION_IMPLEMENTATION_COMPLETE.md",
    "conviction-tracking-explanation.md",
    "FORCE_NEW_SEED_IMPLEMENTATION.md",
    "PROFILE_IMAGES_UPDATE.md",
    "SETTINGS_PERSISTENCE_IMPLEMENTATION.md",
    "SYSTEM_STATUS_REPORT.md",
    "VISUALIZER_ENHANCEMENTS.md",
]

# Module structure (actual modules directory)
MODULES = [
    # Only add if you want to ensure these exist, otherwise leave empty or auto-detect
]

# Asset files to ensure exist and are tracked
ASSETS = [
    "assets/",
    "visualizer/",
    "tampermonkey/",
    "backend/",
    "docs/",
    "examples/",
    "modules/",
    "scripts/",
]

GIT_CONFIG = {
    "core.autocrlf": "true",       # Handle line endings automatically
    "diff.renameLimit": "10000",   # Increase rename detection limit
    "diff.renames": "true"         # Ensure rename detection is enabled
}

class GitSyncException(Exception):
    """Custom exception for Git sync errors"""
    pass

def run_command(command, cwd, check_error=True, silent=False):
    """Run a shell command and return result with improved error handling"""
    if not silent:
        logger.info(f"Running: {command}")
        
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace'
        )
        
        if not silent and result.stdout:
            logger.info(result.stdout.strip())
            
        if result.stderr:
            # Don't treat warnings as errors
            if ("error:" in result.stderr.lower() and "warning:" not in result.stderr.lower()) or result.returncode != 0:
                logger.error(f"❌ {result.stderr.strip()}")
                if check_error:
                    raise GitSyncException(result.stderr.strip())
            elif "warning:" in result.stderr.lower():
                logger.warning(f"⚠️ {result.stderr.strip()}")
            elif not silent:
                logger.info(result.stderr.strip())
                
        return result
    except Exception as e:
        logger.error(f"Command failed: {command}")
        logger.error(f"Error: {str(e)}")
        if check_error:
            raise GitSyncException(f"Command failed: {str(e)}")
        return None

def get_current_branch(cwd):
    """Get the current Git branch."""
    result = run_command("git branch --show-current", cwd, silent=True)
    if result and result.returncode == 0:
        branch = result.stdout.strip()
        if branch:
            return branch
            
    # Fallback to more robust method if the above doesn't work
    result = run_command("git rev-parse --abbrev-ref HEAD", cwd, silent=True)
    if result and result.returncode == 0:
        branch = result.stdout.strip()
        if branch and branch != "HEAD":
            return branch
            
    return DEFAULT_BRANCH

def apply_git_configs():
    """Apply optimal git configuration for this repository."""
    logger.info("🔧 Applying optimal Git configuration")
    for key, value in GIT_CONFIG.items():
        run_command(f"git config {key} {value}", REPO_PATH)

def ensure_directories_exist():
    """Ensure all required directories exist."""
    logger.info("📁 Checking required directories")
    directories = ["modules", "assets", "examples", "docs"]
    for directory in directories:
        dir_path = os.path.join(REPO_PATH, directory)
        if not os.path.exists(dir_path):
            logger.info(f"Creating directory: {directory}")
            os.makedirs(dir_path)
            
            # Create a .gitkeep file to ensure empty directories are tracked
            gitkeep_path = os.path.join(dir_path, ".gitkeep")
            if not os.path.exists(gitkeep_path):
                with open(gitkeep_path, "w") as f:
                    f.write("# This file ensures the directory is tracked by git\n")
                logger.info(f"Created .gitkeep in {directory}")

def create_gitignore():
    """Create .gitignore file if it doesn't exist."""
    gitignore_path = os.path.join(REPO_PATH, ".gitignore")
    if not os.path.exists(gitignore_path):
        logger.info("📝 Creating .gitignore file")
        
        gitignore_content = """# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
dist/
build/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
*.log
logs/
sync_log.txt

# IDE files
.vscode/
.idea/
*.swp
*.swo
*~

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Python
__pycache__/
*.py[cod]
*$py.class
*.so

# Personal configuration
personal_config.json
local_settings.json
user_data/

# Temporary files
*.tmp
*.temp
.cache/

# Facebook specific
facebook_session.json
profile_cache/
scraped_data/
exports/*.json
exports/*.csv

# Tampermonkey backups
*.backup.js
"""
        
        with open(gitignore_path, "w", encoding="utf-8") as f:
            f.write(gitignore_content)
        
        logger.info("✅ Created .gitignore file")
        return True
    
    return False

def ensure_files_tracked():
    """Check that all core files are being tracked by Git."""
    logger.info("📎 Checking that all files are tracked")
    # Get list of tracked files
    result = run_command("git ls-files", REPO_PATH, silent=True)
    tracked_files = result.stdout.strip().split("\n") if result and result.returncode == 0 else []
    
    # Check core files (must exist)
    missing_core_files = []
    for file in CORE_FILES:
        file_path = os.path.join(REPO_PATH, file)
        
        # Check if file exists
        if not os.path.exists(file_path):
            logger.warning(f"⚠️ Core file doesn't exist: {file}")
            missing_core_files.append(file)
            continue
            
        # Check if file is tracked
        if file not in tracked_files:
            logger.info(f"Adding core file: {file}")
            run_command(f"git add {file}", REPO_PATH)
    
    # Check optional files (track if they exist)
    for file in OPTIONAL_FILES:
        file_path = os.path.join(REPO_PATH, file)
        
        if os.path.exists(file_path) and file not in tracked_files:
            logger.info(f"Adding optional file: {file}")
            run_command(f"git add {file}", REPO_PATH)
    
    # Check modules (only if modules directory exists)
    modules_dir = os.path.join(REPO_PATH, "modules")
    if os.path.exists(modules_dir):
        for module in MODULES:
            module_path = os.path.join(REPO_PATH, module)
            
            if os.path.exists(module_path) and module not in tracked_files:
                logger.info(f"Adding module: {module}")
                run_command(f"git add {module}", REPO_PATH)
    
    # Check assets (only if assets directory exists)
    assets_dir = os.path.join(REPO_PATH, "assets")
    if os.path.exists(assets_dir):
        for asset in ASSETS:
            asset_path = os.path.join(REPO_PATH, asset)
            
            if os.path.exists(asset_path) and asset not in tracked_files:
                logger.info(f"Adding asset: {asset}")
                run_command(f"git add {asset}", REPO_PATH)
    
    if missing_core_files:
        logger.warning(f"⚠️ Missing core files: {', '.join(missing_core_files)}")
        logger.info("💡 These files should be created for a complete project")
    
    return len(missing_core_files) == 0

def is_git_repo(path):
    """Check if the given path is a Git repository."""
    result = run_command("git rev-parse --is-inside-work-tree", path, check_error=False, silent=True)
    return result is not None and result.returncode == 0

def init_or_update_repo():
    """Initialize a new Git repository or update the existing one."""
    if is_git_repo(REPO_PATH):
        logger.info("📦 Updating existing Git repository")
        
        # Check if origin remote exists
        result = run_command("git remote get-url origin", REPO_PATH, check_error=False, silent=True)
        if result and result.returncode != 0:
            # Origin doesn't exist, add it
            logger.info("🔗 Adding origin remote")
            run_command(f"git remote add origin {REMOTE_URL}", REPO_PATH, check_error=False)
        else:
            # Origin exists, check if URL is correct
            if result and hasattr(result, 'stdout'):
                current_url = result.stdout.strip()
                if current_url != REMOTE_URL:
                    logger.info(f"🔄 Updating remote URL from {current_url} to {REMOTE_URL}")
                    run_command(f"git remote set-url origin {REMOTE_URL}", REPO_PATH)
                else:
                    logger.info("✅ Origin remote already configured correctly")
            else:
                logger.warning("⚠️ Unable to determine current remote URL")
                run_command(f"git remote set-url origin {REMOTE_URL}", REPO_PATH)
                
    else:
        logger.info("🆕 Initializing new Git repository")
        run_command("git init", REPO_PATH)
        
        # Set default branch to master (to match your existing branch)
        run_command("git branch -M master", REPO_PATH, check_error=False)
        
        # Set up the remote
        logger.info("🔗 Adding origin remote")
        run_command(f"git remote add origin {REMOTE_URL}", REPO_PATH, check_error=False)
    
    # Create .gitignore if needed
    create_gitignore()
    
    # Make sure directories exist
    ensure_directories_exist()
    
    # Ensure files are tracked
    all_files_exist = ensure_files_tracked()
    
    if not all_files_exist:
        logger.warning("⚠️ Some core files are missing. The project may be incomplete.")
    
    return all_files_exist

def pull_latest_changes():
    """Pull the latest changes from the remote repository."""
    branch = get_current_branch(REPO_PATH)
    logger.info(f"⬇️ Pulling latest changes from {branch}")
    
    try:
        # First check if the remote repository exists and we can connect
        result = run_command("git ls-remote origin", REPO_PATH, check_error=False, silent=True)
        if result and result.returncode == 0:
            # Remote exists and is accessible, try to pull
            pull_result = run_command(f"git pull origin {branch}", REPO_PATH, check_error=False)
            if pull_result and pull_result.returncode == 0:
                logger.info("✅ Successfully pulled latest changes")
            else:
                logger.warning("⚠️ Pull failed, but continuing with local changes")
        else:
            logger.warning("⚠️ Remote repository not accessible or doesn't exist yet. Will try to push.")
            
    except GitSyncException as e:
        logger.warning(f"⚠️ Pull encountered issues, continuing anyway: {str(e)}")

def commit_and_push():
    """Commit changes and push to the remote repository."""
    # Add all files
    run_command("git add .", REPO_PATH)
    
    # Check if there are changes to commit
    status = run_command("git status --porcelain", REPO_PATH, silent=True)
    if status is None or not status.stdout.strip():
        logger.info("✅ No changes to commit")
        return
        
    # Show what will be committed
    logger.info("📝 Changes to be committed:")
    run_command("git status --short", REPO_PATH)
    
    # Commit changes
    logger.info(f"💾 Committing changes: {COMMIT_MESSAGE}")
    run_command(f'git commit -m "{COMMIT_MESSAGE}"', REPO_PATH)
    
    # Push to remote
    branch = get_current_branch(REPO_PATH)
    logger.info(f"⬆️ Pushing to {branch}")
    
    try:
        # Try a regular push first
        run_command(f"git push origin {branch}", REPO_PATH)
        logger.info("✅ Successfully pushed changes")
    except GitSyncException as e:
        # If regular push fails, try force push (useful for first push)
        logger.warning("⚠️ Regular push failed, trying force push for initial setup")
        try:
            run_command(f"git push -u origin {branch}", REPO_PATH)
            logger.info("✅ Successfully force pushed changes (initial setup)")
        except GitSyncException as e2:
            logger.error(f"❌ Both push attempts failed: {str(e2)}")
            logger.error("💡 Make sure the repository exists on GitHub and you have push access")
            raise

def generate_changelog():
    """Generate a changelog from commits."""
    logger.info("📋 Generating changelog")
    
    # Get the last tag or use the initial commit if no tags
    last_tag = run_command("git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD", 
                           REPO_PATH, check_error=False, silent=True)
    
    if last_tag and last_tag.returncode == 0:
        from_ref = last_tag.stdout.strip()
        
        # Get commits since last tag
        commits = run_command(f'git log --pretty=format:"- %s" {from_ref}..HEAD', 
                              REPO_PATH, check_error=False, silent=True)
        
        if commits and commits.stdout.strip():
            changelog = f"# Changelog since {from_ref}\n\n{commits.stdout}"
            changelog_path = os.path.join(REPO_PATH, "CHANGELOG.md")
            
            # Write to changelog file
            with open(changelog_path, "w", encoding="utf-8") as f:
                f.write(changelog)
                
            logger.info(f"✅ Changelog written to CHANGELOG.md")
            
            # Add changelog to git
            run_command("git add CHANGELOG.md", REPO_PATH)
            
            return True
            
    logger.info("📋 No changes for changelog or no previous tag")
    return False

def main():
    """Main execution flow."""
    try:
        logger.info("🚀 Starting GitHub sync process")
        logger.info(f"Repository path: {REPO_PATH}")
        
        # Initialize or update Git repository
        init_or_update_repo()
        
        # Apply optimal Git configs
        apply_git_configs()
        
        # Pull latest changes
        pull_latest_changes()
        
        # Generate changelog
        generate_changelog()
        
        # Commit and push changes
        commit_and_push()
        
        logger.info("🎉 Sync completed successfully")
        
    except GitSyncException as e:
        logger.error(f"❌ Sync failed: {str(e)}")
        return 1
        
    except Exception as e:
        logger.error(f"❌ Unexpected error: {str(e)}")
        return 1
        
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        logger.info("⏹️ Process interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.critical(f"💥 Fatal error: {str(e)}", exc_info=True)
        sys.exit(1)