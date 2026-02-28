// static/ui-config.js — Clean UI configuration object
(function () {
  window.UI_CONFIG = {
    controlNode: "FRA301",
    controlIP: "192.168.0.120",
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
