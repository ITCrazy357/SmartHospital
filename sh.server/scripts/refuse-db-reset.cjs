console.error('Automatic database reset is disabled. Use db:backup and restore into a separate empty database; never erase clinical data through a package shortcut.');
process.exitCode = 1;
