# AGENTS.md

## Project goal

The goal of this project is to draw composite wireline logs. The data is given to javascript classes in format of array of objects. Each object will contain a required field of depth and optional other fields with numeric values for other logs. The library is to run in a browser.

## Design

There should be 3 main classes:
- CompositeLog: This is the wrapper class for the tracks. It should hold an array of LogTrack objects.
- LogTrack: This will contain multiple Log objects. It will contain meta information and header information for the logs.
- Log: This class will be the class that will actually draw the log into the given Track with given configurations and data.