# Only copy the Hadoop distribution from amd64; execute Java on the host architecture.
FROM --platform=linux/amd64 apache/hadoop:3.4.3@sha256:127774dadab40ce84df7ac668a7a8c99945688b3fe336f1388f4477ca33e1529 AS distribution
FROM eclipse-temurin:11-jre@sha256:e9aa18936347d6496697b2b2698b7ec1e228ee3d8d0871302d6a8ccd0ce8db38

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=distribution /opt/hadoop /opt/hadoop
ENV HADOOP_HOME=/opt/hadoop \
    HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop \
    HADOOP_LOG_DIR=/tmp/hadoop-logs \
    PATH=/opt/hadoop/bin:$PATH
WORKDIR /opt/hadoop
