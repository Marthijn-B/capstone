#!/bin/bash

set -ev

# echo ${TRAVIS_EVENT_TYPE};
#    + returns 'api' when manually triggering build
#    + returns 'push' when pushing to remote branch
#    + returns 'cron' when called by the travis cron job trigger

if [ "${TRAVIS_EVENT_TYPE}" = "cron" ]; then
        npm test;
        echo "running selenium headless browser tests";
        pip install selenium && pip install sauceclient
<<<<<<< HEAD
        python tests/seleniumPythonTest/run_all_tests.py;
        
    else      
=======
        python tests/seleniumPythonTest/click_tutorial.py;

    else
>>>>>>> 9100030e31966945f9fc03b1478dd3d5e53a3c52
        npm test;
fi
