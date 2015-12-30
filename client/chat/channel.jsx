import React from 'react'
import ContentLayout from '../content/content-layout.jsx'

export default props => {
  const title = `#${props.routeParams.channel}`
  return (<ContentLayout title={title}>
    <span>Do you really want these? Maybe try <a href='http://facebook.com'>Facebook</a></span>
  </ContentLayout>)
}
