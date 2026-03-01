// static/ui-config.js — UI configuration object
// These values are patched automatically by deploy.sh during installation.
// To change after deployment, edit this file in the APP_DIR/static/ directory.
(function () {
  window.UI_CONFIG = {
    controlNode: "YOURNODE",
    controlIP: "0.0.0.0",
    playbookRoot: "/var/lib/rundeck/projects/ansible/DellServerAuto/MainPlayBook/Test4/DellServerAuto_4",
    defaultInventory: "target_hosts",
    version: "2.0.0",
    workflows: {
      configbuild: "Config Build (ConfigMain.yaml)",
      postprov: "Post Provisioning",
      quickqc: "Quick QC",
    },
  };
})();
