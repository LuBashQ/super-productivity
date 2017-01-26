/**
 * @ngdoc service
 * @name superProductivity.Tasks
 * @description
 * # Tasks
 * Service in the superProductivity.
 */

(function () {
  'use strict';

  const IPC_EVENT_IDLE = 'WAS_IDLE';
  const IPC_EVENT_UPDATE_TIME_SPEND_FOR_CURRENT = 'UPDATE_TIME_SPEND';
  const IPC_EVENT_CURRENT_TASK_UPDATED = 'CHANGED_CURRENT_TASK';

  /* @ngInject */
  class Tasks {

    constructor($localStorage, Uid, $rootScope, Dialogs, IS_ELECTRON, $mdToast, Notifier, ShortSyntax, ParseDuration, TasksUtil, Jira) {
      this.$localStorage = $localStorage;
      this.Uid = Uid;
      this.$rootScope = $rootScope;
      this.Dialogs = Dialogs;
      this.$mdToast = $mdToast;
      this.Notifier = Notifier;
      this.ShortSyntax = ShortSyntax;
      this.ParseDuration = ParseDuration;
      this.TasksUtil = TasksUtil;
      this.IS_ELECTRON = IS_ELECTRON;
      this.Jira = Jira;

      this.isShowTakeBreakNotification = true;

      // SETUP HANDLERS FOR ELECTRON EVENTS
      if (IS_ELECTRON) {
        let that = this;

        let isIdleDialogOpen = false;
        // handler for time spent tracking
        window.ipcRenderer.on(IPC_EVENT_UPDATE_TIME_SPEND_FOR_CURRENT, (ev, evData) => {
          if (!isIdleDialogOpen) {
            let timeSpentInMs = evData.timeSpentInMs;
            let idleTimeInMs = evData.idleTimeInMs;

            // only track if there is a task
            if (this.$rootScope.r.currentTask) {

              that.addTimeSpent(this.$rootScope.r.currentTask, timeSpentInMs);
              that.updateCurrent(this.$rootScope.r.currentTask, true);
              that.checkTakeToTakeABreak(timeSpentInMs, idleTimeInMs);

              // we need to manually call apply as this is an outside event
              this.$rootScope.$apply();
            }
          }
        });

        // handler for idle event
        window.ipcRenderer.on(IPC_EVENT_IDLE, (ev, params) => {
          const idleTime = params.idleTimeInMs;
          const minIdleTimeInMs = params.minIdleTimeInMs;

          // do not show as long as the user hasn't decided
          this.isShowTakeBreakNotification = false;

          if (!isIdleDialogOpen) {
            isIdleDialogOpen = true;
            this.Dialogs('WAS_IDLE', { idleTime, minIdleTimeInMs })
              .then(() => {
                // if tracked
                this.checkTakeToTakeABreak(idleTime);
                this.isShowTakeBreakNotification = true;
                isIdleDialogOpen = false;
              }, () => {
                // if not tracked
                // unset currentSession.timeWorkedWithoutBreak
                this.$rootScope.r.currentSession.timeWorkedWithoutBreak = undefined;
                this.isShowTakeBreakNotification = true;
                isIdleDialogOpen = false;
              });
          }
        });
      }
    }

    checkTakeToTakeABreak(timeSpentInMs, idleTimeInMs) {
      const MIN_IDLE_VAL_TO_TAKE_A_BREAK_FROM_TAKE_A_BREAK = 9999;

      if (this.$rootScope.r.config && this.$rootScope.r.config.isTakeABreakEnabled) {
        if (!this.$rootScope.r.currentSession) {
          this.$rootScope.r.currentSession = {};
        }
        // add or create moment duration for timeWorkedWithoutBreak
        if (this.$rootScope.r.currentSession.timeWorkedWithoutBreak) {
          // convert to moment to be save
          this.$rootScope.r.currentSession.timeWorkedWithoutBreak = moment.duration(this.$rootScope.r.currentSession.timeWorkedWithoutBreak);
          this.$rootScope.r.currentSession.timeWorkedWithoutBreak.add(moment.duration({ milliseconds: timeSpentInMs }));
        } else {
          this.$rootScope.r.currentSession.timeWorkedWithoutBreak = moment.duration(timeSpentInMs);
        }

        if (moment.duration(this.$rootScope.r.config.takeABreakMinWorkingTime)
            .asSeconds() < this.$rootScope.r.currentSession.timeWorkedWithoutBreak.asSeconds()) {

          if (idleTimeInMs > MIN_IDLE_VAL_TO_TAKE_A_BREAK_FROM_TAKE_A_BREAK) {
            return;
          }

          if (this.isShowTakeBreakNotification) {
            let toast = this.$mdToast.simple()
              .textContent('Take a break! You have been working for ' + this.ParseDuration.toString(this.$rootScope.r.currentSession.timeWorkedWithoutBreak) + ' without one. Go away from the computer! Makes you more productive in the long run!')
              .action('I already did!')
              .hideDelay(20000)
              .position('bottom');
            this.$mdToast.show(toast).then(function (response) {
              if (response === 'ok') {
                // re-add task on undo
                this.$rootScope.r.currentSession.timeWorkedWithoutBreak = undefined;
              }
            });

            this.Notifier({
              title: 'Take a break!',
              message: 'Take a break! You have been working for ' + this.ParseDuration.toString(this.$rootScope.r.currentSession.timeWorkedWithoutBreak) + ' without one. Go away from the computer! Makes you more productive in the long run!',
              sound: true,
              wait: true
            });
          }
        }
      }
    }

    // GET DATA
    getCurrent() {
      let currentTask;
      let subTaskMatch;

      // we want to sync the ls current task with the this.$rootScope current task
      // that's why we load the current task from the ls directly
      if (this.$localStorage.currentTask) {
        currentTask = _.find(this.$localStorage.tasks, (task) => {
          if (task.subTasks) {
            let subTaskMatchTmp = _.find(task.subTasks, { id: this.$localStorage.currentTask.id });
            if (subTaskMatchTmp) {
              subTaskMatch = subTaskMatchTmp;
            }
          }
          return task.id === this.$localStorage.currentTask.id;
        });

        this.$localStorage.currentTask = this.$rootScope.r.currentTask = currentTask || subTaskMatch;
      }
      return this.$rootScope.r.currentTask;
    }

    getById(taskId) {
      return _.find(this.$rootScope.r.tasks, ['id', taskId]) || _.find(this.$rootScope.r.backlogTasks, ['id', taskId]) || _.find(this.$rootScope.r.doneBacklogTasks, ['id', taskId]);
    }

    getBacklog() {
      this.TasksUtil.checkDupes(this.$localStorage.backlogTasks);
      this.TasksUtil.convertDurationStringsToMomentForList(this.$localStorage.backlogTasks);
      return this.$localStorage.backlogTasks;
    }

    getDoneBacklog() {
      this.TasksUtil.checkDupes(this.$localStorage.doneBacklogTasks);
      this.TasksUtil.convertDurationStringsToMomentForList(this.$localStorage.doneBacklogTasks);
      return this.$localStorage.doneBacklogTasks;
    }

    getToday() {
      this.TasksUtil.checkDupes(this.$localStorage.tasks);
      this.TasksUtil.convertDurationStringsToMomentForList(this.$localStorage.tasks);
      return this.$localStorage.tasks;
    }

    getAllTasks() {
      const todaysT = this.getToday();
      const backlogT = this.getBacklog();
      const doneBacklogT = this.getDoneBacklog();

      return _.concat(todaysT, backlogT, doneBacklogT);
    }

    getCompleteWorkLog() {
      const allTasks = this.TasksUtil.flattenTasks(this.getAllTasks());
      const worklog = {};
      _.each(allTasks, (task) => {
        if (task.timeSpentOnDay) {
          _.forOwn(task.timeSpentOnDay, (val, dateStr) => {
            if (task.timeSpentOnDay[dateStr]) {
              const split = dateStr.split('-');
              const year = parseInt(split[0], 10);
              const month = parseInt(split[1], 10);
              const day = parseInt(split[2], 10);

              if (!worklog[year]) {
                worklog[year] = {
                  timeSpent: moment.duration(),
                  entries: {}
                };
              }
              if (!worklog[year].entries[month]) {
                worklog[year].entries[month] = {
                  timeSpent: moment.duration(),
                  entries: {}
                };
              }
              if (!worklog[year].entries[month].entries[day]) {
                worklog[year].entries[month].entries[day] = {
                  timeSpent: moment.duration(),
                  entries: [],
                  dateStr: dateStr,
                  id: this.Uid()
                };
              }

              worklog[year].entries[month].entries[day].timeSpent = worklog[year].entries[month].entries[day].timeSpent.add(task.timeSpentOnDay[dateStr]);
              worklog[year].entries[month].entries[day].entries.push({
                task: task,
                timeSpent: moment.duration(task.timeSpentOnDay[dateStr])
              });
            }
          });
        }
      });

      // calculate time spent totals once too
      _.forOwn(worklog, (val, key) => {
        let year = worklog[key];
        _.forOwn(year.entries, (val, key) => {
          let month = year.entries[key];
          _.forOwn(month.entries, (val, key) => {
            let day = month.entries[key];
            month.timeSpent = month.timeSpent.add(day.timeSpent);
          });

          year.timeSpent = year.timeSpent.add(month.timeSpent);
        });
      });

      return worklog;
    }

    getUndoneToday(isSubTasksInsteadOfParent) {
      let undoneTasks;

      // get flattened result of all undone tasks including subtasks
      if (isSubTasksInsteadOfParent) {
        // get all undone tasks tasks
        undoneTasks = this.TasksUtil.flattenTasks(this.$localStorage.tasks, (parentTask) => {
          return parentTask && !parentTask.isDone;
        }, (subTask) => {
          return !subTask.isDone;
        });
      }

      // just get parent undone tasks
      else {
        undoneTasks = _.filter(this.$localStorage.tasks, (task) => {
          return task && !task.isDone;
        });
      }

      return undoneTasks;
    }

    getDoneToday() {
      return _.filter(this.$localStorage.tasks, (task) => {
        return task && task.isDone;
      });
    }

    getTotalTimeWorkedOnTasksToday() {
      let tasks = this.getToday();
      let totalTimeSpentTasks = moment.duration();
      if (tasks) {
        _.each(tasks, (task) => {
          totalTimeSpentTasks.add(task.timeSpent);
        });
      }
      return totalTimeSpentTasks;
    }

    getTimeWorkedToday() {
      let tasks = this.getToday();
      let todayStr = this.TasksUtil.getTodayStr();
      let totalTimeWorkedToday;
      if (tasks.length > 0) {
        totalTimeWorkedToday = moment.duration();
        _.each(tasks, (task) => {
          if (task.subTasks && task.subTasks.length) {
            _.each(task.subTasks, (subTask) => {
              if (subTask.timeSpentOnDay && subTask.timeSpentOnDay[todayStr]) {
                totalTimeWorkedToday.add(subTask.timeSpentOnDay[todayStr]);
              }
            });
          } else {
            if (task.timeSpentOnDay && task.timeSpentOnDay[todayStr]) {
              totalTimeWorkedToday.add(task.timeSpentOnDay[todayStr]);
            }
          }
        });
      }
      return totalTimeWorkedToday;
    }

    // UPDATE DATA
    addToday(task) {
      if (task && task.title) {
        this.$localStorage.tasks.push(this.createTask(task));
        // update global pointer for today tasks
        this.$rootScope.r.tasks = this.$localStorage.tasks;
        return true;
      }
    }

    createTask(task) {
      let transformedTask = {
        title: task.title,
        id: this.Uid(),
        created: moment(),
        notes: task.notes,
        parentId: task.parentId,
        timeEstimate: task.timeEstimate || task.originalEstimate,
        timeSpent: task.timeSpent || task.originalTimeSpent,
        originalId: task.originalId,
        originalKey: task.originalKey,
        originalType: task.originalType,
        originalLink: task.originalLink,
        originalStatus: task.originalStatus,
        originalEstimate: task.originalEstimate,
        originalTimeSpent: task.originalTimeSpent,
        originalAttachment: task.originalAttachment,
        originalComments: task.originalComments,
        originalUpdated: task.originalUpdated
      };

      task.progress = this.TasksUtil.calcProgress(task);
      return this.ShortSyntax(transformedTask);
    }

    markAsDone(task) {
      const parentTask = task.parentId && this.getById(task.parentId);

      task.isDone = true;
      task.doneDate = moment();

      if (this.IS_ELECTRON) {
        if (this.TasksUtil.isJiraTask(task)) {
          this.Jira.updateStatus(task, 'DONE');
        }
        if (this.TasksUtil.isJiraTask(task) || this.TasksUtil.isJiraTask(parentTask)) {
          this.Jira.addWorklog(task);
        }
      }
    }

    updateCurrent(task, isCallFromTimeTracking) {
      //const isCurrentTaskChanged = ((task && task.id) !== ($rootScope.currentTask && $rootScope.currentTask.id)) && !(!task && !$rootScope.currentTask);

      // update totalTimeSpent for buggy macos
      if (task) {
        task.timeSpent = this.TasksUtil.calcTotalTimeSpentOnTask(task);
      }

      // check if in electron context
      if (this.IS_ELECTRON) {
        if (!isCallFromTimeTracking) {
          // check for updates
          // NOTE: if checks for isJiraTicket are made in function
          this.Jira.checkUpdatesForTaskOrParent(task);
        }

        if (task && task.title) {
          window.ipcRenderer.send(IPC_EVENT_CURRENT_TASK_UPDATED, task);
        }
      }

      this.$localStorage.currentTask = task;
      // update global pointer
      this.$rootScope.r.currentTask = this.$localStorage.currentTask;

    }

    removeTimeSpent(task, timeSpentToRemoveAsMoment) {
      const TODAY_STR = this.TasksUtil.getTodayStr();
      let timeSpentToRemoveInMs;
      let timeSpentCalculatedOnDay;
      let parentTask;

      if (timeSpentToRemoveAsMoment.asMilliseconds) {
        timeSpentToRemoveInMs = timeSpentToRemoveAsMoment.asMilliseconds();
      } else {
        timeSpentToRemoveInMs = timeSpentToRemoveAsMoment;
      }

      // track time spent on days
      if (!task.timeSpentOnDay) {
        task.timeSpentOnDay = {};
      }
      if (task.timeSpentOnDay[TODAY_STR]) {
        // convert to moment again in case it messed up
        timeSpentCalculatedOnDay = moment.duration(task.timeSpentOnDay[TODAY_STR]);
        timeSpentCalculatedOnDay.subtract(timeSpentToRemoveInMs, 'milliseconds');
        if (timeSpentCalculatedOnDay.asSeconds() > 0) {
          task.timeSpentOnDay[TODAY_STR] = timeSpentCalculatedOnDay;
        } else {
          delete task.timeSpentOnDay[TODAY_STR];
        }
      }

      // do the same for the parent, in case the sub tasks are deleted
      if (task.parentId) {
        // TODO calc parent task timeSpent
        parentTask = this.getById(task.parentId);
        parentTask.timeSpentOnDay = this.mergeTotalTimeSpentOnDayFrom(parentTask.subTasks);
        parentTask.progress = this.TasksUtil.calcProgress(parentTask);
      }

      // track total time spent
      task.timeSpent = this.TasksUtil.calcTotalTimeSpentOnTask(task);
      task.progress = this.TasksUtil.calcProgress(task);

      return task;
    }

    addTimeSpent(task, timeSpentInMsOrMomentDuration) {
      // use mysql date as it is sortable
      const TODAY_STR = this.TasksUtil.getTodayStr();
      let timeSpentCalculatedOnDay;
      let timeSpentInMs;
      let parentTask;

      if (timeSpentInMsOrMomentDuration.asMilliseconds) {
        timeSpentInMs = timeSpentInMsOrMomentDuration.asMilliseconds();
      } else {
        timeSpentInMs = timeSpentInMsOrMomentDuration;
      }

      // if not set set started pointer
      if (!task.started) {
        task.started = moment();
      }

      // track time spent on days
      if (!task.timeSpentOnDay) {
        task.timeSpentOnDay = {};
      }
      if (task.timeSpentOnDay[TODAY_STR]) {
        timeSpentCalculatedOnDay = moment.duration(task.timeSpentOnDay[TODAY_STR]);
        timeSpentCalculatedOnDay.add(moment.duration({ milliseconds: timeSpentInMs }));
      } else {
        timeSpentCalculatedOnDay = moment.duration({ milliseconds: timeSpentInMs });
      }

      // assign values
      task.timeSpentOnDay[TODAY_STR] = timeSpentCalculatedOnDay;
      task.lastWorkedOn = moment();

      // do the same for the parent, in case the sub tasks are deleted
      if (task.parentId) {
        parentTask = this.getById(task.parentId);
        // also set parent task to started if there is one
        if (!parentTask.started) {
          parentTask.started = moment();
        }

        // also track time spent on day for parent task
        // TODO calc parent task timeSpent
        parentTask.timeSpentOnDay = this.TasksUtil.mergeTotalTimeSpentOnDayFrom(parentTask.subTasks);
        parentTask.lastWorkedOn = moment();
        parentTask.progress = this.TasksUtil.calcProgress(parentTask);
      }

      // track total time spent
      task.timeSpent = this.TasksUtil.calcTotalTimeSpentOnTask(task);
      task.progress = this.TasksUtil.calcProgress(task);

      return task;
    }

    updateEstimate(task, estimate) {
      task.timeEstimate = estimate;
      task.progress = this.TasksUtil.calcProgress(task);
      if (task.parentId) {
        let parentTask = this.getById(task.parentId);
        parentTask.progress = this.TasksUtil.calcProgress(parentTask);
      }
    }

    updateTimeSpentOnDay(task, timeSpentOnDay) {
      if (!angular.isObject(timeSpentOnDay)) {
        throw 'timeSpentOnDay should be an object';
      }

      let totalTimeSpent = moment.duration();
      _.forOwn(timeSpentOnDay, (val, dateStr) => {
        if (timeSpentOnDay[dateStr]) {
          let momentVal = moment.duration(timeSpentOnDay[dateStr]);
          if (momentVal.asSeconds() < 1) {
            delete timeSpentOnDay[dateStr];
          } else {
            totalTimeSpent.add(momentVal);
          }
        } else {
          // clean empty
          delete timeSpentOnDay[dateStr];
        }
      });
      task.timeSpentOnDay = timeSpentOnDay;
      task.timeSpent = totalTimeSpent;
      task.progress = this.TasksUtil.calcProgress(task);

      // TODO this is not clear and probably buggy
      //if (task.parentId) {
      //  const parentTask = this.getById(task.parentId);
      //  // also track time spent on day for parent task
      //  parentTask.progress = this.TasksUtil.calcProgress(parentTask);
      //}
    }

    updateToday(tasks) {
      this.$localStorage.tasks = tasks;
      // update global pointer
      this.$rootScope.r.tasks = this.$localStorage.tasks;
    }

    updateBacklog(tasks) {
      this.$localStorage.backlogTasks = tasks;
      // update global pointer
      this.$rootScope.r.backlogTasks = this.$localStorage.backlogTasks;
    }

    addTasksToTopOfBacklog(tasks) {
      this.$localStorage.backlogTasks = tasks.concat(this.$localStorage.backlogTasks);
      // update global pointer
      this.$rootScope.r.backlogTasks = this.$localStorage.backlogTasks;
    }

    updateDoneBacklog(tasks) {
      this.$localStorage.doneBacklogTasks = tasks;
      // update global pointer
      this.$rootScope.r.doneBacklogTasks = this.$localStorage.doneBacklogTasks;
    }

    addDoneTasksToDoneBacklog() {
      let doneTasks = this.getDoneToday().slice(0);
      this.$localStorage.doneBacklogTasks = doneTasks.concat(this.$localStorage.doneBacklogTasks);
      // update global pointer
      this.$rootScope.r.doneBacklogTasks = this.$localStorage.doneBacklogTasks;
    }

    finishDay(clearDoneTasks, moveUnfinishedToBacklog) {
      if (clearDoneTasks) {
        // add tasks to done backlog
        this.addDoneTasksToDoneBacklog();
        // remove done tasks from today
        this.updateToday(this.getUndoneToday());
      }

      if (moveUnfinishedToBacklog) {
        this.addTasksToTopOfBacklog(this.getUndoneToday());
        if (clearDoneTasks) {
          this.updateToday([]);
        } else {
          this.updateToday(this.getDoneToday());
        }
      }

      // also remove the current task to prevent time tracking
      this.updateCurrent(null);
    }
  }

  angular
    .module('superProductivity')
    .service('Tasks', Tasks);

})();
