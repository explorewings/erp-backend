-- Menu access is granted only by an explicit allowed row; stale deny rows are unnecessary.
DELETE FROM access WHERE type = 'menu' AND allowed = false;
